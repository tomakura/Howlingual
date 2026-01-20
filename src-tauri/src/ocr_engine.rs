use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};
use ndarray::Array4;
use ort::session::{builder::GraphOptimizationLevel, Session};
// use rayon::prelude::*; // Reverted
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[allow(dead_code)]
pub struct PaddleOcr {
    det_session: Session,
    rec_session: Session,
    keys: Vec<String>,
}

#[allow(dead_code)]
impl PaddleOcr {
    pub fn new<P: AsRef<Path>>(
        det_model_path: P,
        rec_model_path: P,
        keys_path: P,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let det_session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(det_model_path)?;

        let rec_session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(rec_model_path)?;

        let keys_file = File::open(keys_path)?;
        let reader = BufReader::new(keys_file);
        let mut keys = Vec::new();
        keys.push("blank".to_string()); // Index 0 = blank for Paddle v5
        for line in reader.lines() {
            keys.push(line?);
        }
        keys.push(" ".to_string()); // Space at the end
                                    // keys.push("blank".to_string()); // Removed from end
                                    // println!("[ocr_engine] Loaded dictionary: {} keys", keys.len());

        Ok(Self {
            det_session,
            rec_session,
            keys,
        })
    }

    pub fn recognize(&mut self, img: &DynamicImage) -> Result<String, Box<dyn std::error::Error>> {
        // 1. Detection
        let (boxes, scale_x, scale_y) = self.detect(img)?;

        if boxes.is_empty() {
            return self.recognize_line(img);
        }

        // Sort boxes top-down, left-to-right
        let mut sorted_boxes = boxes;
        sorted_boxes.sort_by(|a, b| {
            if (a.y as i32 - b.y as i32).abs() < 10 {
                a.x.cmp(&b.x)
            } else {
                a.y.cmp(&b.y)
            }
        });

        let mut results = Vec::new();
        let (w, h) = img.dimensions();

        for rect in sorted_boxes {
            // Unscale and crop
            let x = (rect.x as f32 / scale_x) as u32;
            let y = (rect.y as f32 / scale_y) as u32;
            let width = (rect.w as f32 / scale_x) as u32;
            let height = (rect.h as f32 / scale_y) as u32;

            let x = x.min(w - 1);
            let y = y.min(h - 1);
            let width = width.min(w - x);
            let height = height.min(h - y);

            if width < 5 || height < 5 {
                continue;
            }

            let crop = img.crop_imm(x, y, width, height);
            let text = self.recognize_line(&crop)?;
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                results.push(text);
            }
        }

        Ok(results.join("\n"))
    }

    fn detect(
        &mut self,
        img: &DynamicImage,
    ) -> Result<(Vec<Rect>, f32, f32), Box<dyn std::error::Error>> {
        let (w, h) = img.dimensions();
        let limit = 1600; // Balanced for performance and accuracy
        let mut ratio = 1.0;
        if w.max(h) > limit {
            ratio = limit as f32 / w.max(h) as f32;
        }

        // Ensure strictly divisible by 32
        let mut resize_w = (w as f32 * ratio) as u32;
        let mut resize_h = (h as f32 * ratio) as u32;
        resize_w = (resize_w / 32) * 32;
        resize_h = (resize_h / 32) * 32;

        if resize_w == 0 || resize_h == 0 {
            return Err("Invalid image dimensions for detection resizing".into());
        }

        let resized = img.resize_exact(resize_w, resize_h, FilterType::Triangle);
        let scale_x = resize_w as f32 / w as f32;
        let scale_y = resize_h as f32 / h as f32;

        // Preprocess
        let input_tensor = Self::preprocess_det(&resized)?;
        let input_value = ort::value::Tensor::from_array(input_tensor)?;
        let outputs = self.det_session.run(ort::inputs!["x" => input_value])?;

        // Output map name might vary, usually "sigmoid_0.tmp_0" or just output 0
        let output_tensor = outputs.values().next().ok_or("No output")?;
        let (shape, data) = output_tensor.try_extract_tensor::<f32>()?;
        // shape: [1, 1, h, w]
        let out_h = shape[2] as usize;
        let out_w = shape[3] as usize;

        let rects = Self::postprocess_det(data, out_w, out_h, 0.2);
        Ok((rects, scale_x, scale_y))
    }

    fn postprocess_det(map: &[f32], w: usize, h: usize, thresh: f32) -> Vec<Rect> {
        // Simple bitmap generation and contour finding (BFS)
        let mut bitmap = vec![false; w * h];
        for i in 0..map.len() {
            if map[i] > thresh {
                bitmap[i] = true;
            }
        }

        let mut visited = vec![false; w * h];
        let mut rects = Vec::new();
        let mut queue = std::collections::VecDeque::new();

        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                if bitmap[idx] && !visited[idx] {
                    // Start simplified component analysis
                    let mut min_x = x;
                    let mut max_x = x;
                    let mut min_y = y;
                    let mut max_y = y;
                    queue.push_back((x, y));
                    visited[idx] = true;

                    while let Some((cx, cy)) = queue.pop_front() {
                        min_x = min_x.min(cx);
                        max_x = max_x.max(cx);
                        min_y = min_y.min(cy);
                        max_y = max_y.max(cy);

                        let nbs = [
                            (cx.wrapping_sub(1), cy),
                            (cx + 1, cy),
                            (cx, cy.wrapping_sub(1)),
                            (cx, cy + 1),
                        ];
                        for (nx, ny) in nbs {
                            if nx < w && ny < h {
                                let nidx = ny * w + nx;
                                if bitmap[nidx] && !visited[nidx] {
                                    visited[nidx] = true;
                                    queue.push_back((nx, ny));
                                }
                            }
                        }
                    }

                    if (max_x - min_x) > 3 && (max_y - min_y) > 3 {
                        // Unclip logic
                        let width = (max_x - min_x + 1) as f32;
                        let height = (max_y - min_y + 1) as f32;
                        let area = width * height;
                        let perimeter = 2.0 * (width + height);
                        let ratio = 1.6; // Standard unclip ratio
                        let offset = (area * ratio) / perimeter;

                        let new_min_x = (min_x as f32 - offset).max(0.0) as u32;
                        let new_min_y = (min_y as f32 - offset).max(0.0) as u32;
                        let new_max_x = (max_x as f32 + offset).min((w - 1) as f32) as u32;
                        let new_max_y = (max_y as f32 + offset).min((h - 1) as f32) as u32;

                        rects.push(Rect {
                            x: new_min_x,
                            y: new_min_y,
                            w: new_max_x - new_min_x + 1,
                            h: new_max_y - new_min_y + 1,
                        });
                    }
                }
            }
        }
        // println!("[ocr_debug] Detected {} text boxes.", rects.len());
        rects
    }

    fn recognize_line(&mut self, img: &DynamicImage) -> Result<String, Box<dyn std::error::Error>> {
        let h_target = 48; // PP-OCRv5 server usually uses 48
        let (w, h) = img.dimensions();
        let scale = h_target as f32 / h as f32;
        let w_target = (w as f32 * scale) as u32;
        let w_target = if w_target == 0 { 1 } else { w_target };

        let resized = img.resize_exact(w_target, h_target, FilterType::Triangle);
        let input_tensor = Self::preprocess_rec(&resized)?;
        let input_value = ort::value::Tensor::from_array(input_tensor)?;

        let outputs = self.rec_session.run(ort::inputs!["x" => input_value])?;
        let output_tensor = outputs.values().next().ok_or("No output")?;
        let (shape, data) = output_tensor.try_extract_tensor::<f32>()?;

        // shape: [batch, time_steps, num_classes]
        let time_steps = shape[1] as usize;
        let num_classes = shape[2] as usize;

        // Decode CTC
        let mut text = String::new();
        let blank_idx = 0; // Padding is at 0 now
        let mut last_idx = blank_idx;

        // println!("[ocr_debug] Model num_classes: {}, Dictionary keys: {}, Blank idx: {}", num_classes, self.keys.len(), blank_idx);

        // Debug raw indices
        let mut raw_indices = Vec::new();

        for t in 0..time_steps {
            let offset = t * num_classes;
            let probs = &data[offset..offset + num_classes];

            // Argmax
            let mut max_idx = 0;
            let mut max_val = -f32::INFINITY;
            for (i, &val) in probs.iter().enumerate() {
                if val > max_val {
                    max_val = val;
                    max_idx = i;
                }
            }
            raw_indices.push(max_idx);

            if max_idx != last_idx {
                if max_idx != blank_idx && max_idx < self.keys.len() {
                    text.push_str(&self.keys[max_idx]);
                }
                last_idx = max_idx;
            }
        }
        // println!("[ocr_debug] Raw indices: {:?}", raw_indices);
        // println!("[ocr_debug] Decoded text: {}", text);
        Ok(text)
    }

    fn preprocess_det(img: &DynamicImage) -> Result<Array4<f32>, Box<dyn std::error::Error>> {
        let (w, h) = img.dimensions();
        let mut arr = Array4::<f32>::zeros((1, 3, h as usize, w as usize));

        // Normalize: (x/255 - mean) / std
        let mean = [0.485, 0.456, 0.406];
        let std = [0.229, 0.224, 0.225];

        for (x, y, px) in img.pixels() {
            let r = (px[0] as f32 / 255.0 - mean[0]) / std[0];
            let g = (px[1] as f32 / 255.0 - mean[1]) / std[1];
            let b = (px[2] as f32 / 255.0 - mean[2]) / std[2];
            arr[[0, 0, y as usize, x as usize]] = r;
            arr[[0, 1, y as usize, x as usize]] = g;
            arr[[0, 2, y as usize, x as usize]] = b;
        }
        Ok(arr)
    }

    fn preprocess_rec(img: &DynamicImage) -> Result<Array4<f32>, Box<dyn std::error::Error>> {
        let (w, h) = img.dimensions();
        let mut arr = Array4::<f32>::zeros((1, 3, h as usize, w as usize));

        // Normalize: (x/255 - 0.5) / 0.5
        for (x, y, px) in img.pixels() {
            let r = (px[0] as f32 / 255.0 - 0.5) / 0.5;
            let g = (px[1] as f32 / 255.0 - 0.5) / 0.5;
            let b = (px[2] as f32 / 255.0 - 0.5) / 0.5;
            arr[[0, 0, y as usize, x as usize]] = r;
            arr[[0, 1, y as usize, x as usize]] = g;
            arr[[0, 2, y as usize, x as usize]] = b;
        }
        Ok(arr)
    }
}

#[derive(Clone, Copy, Debug)]
#[allow(dead_code)]
struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}
