use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};
use ndarray::Array4;
use ort::session::{builder::GraphOptimizationLevel, Session};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

pub struct PaddleOcr {
    det_session: Session,
    rec_session: Session,
    keys: Vec<String>,
}

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
        keys.push("blank".to_string());
        for line in reader.lines() {
            keys.push(line?);
        }
        keys.push(" ".to_string());

        Ok(Self {
            det_session,
            rec_session,
            keys,
        })
    }

    pub fn recognize(&mut self, img: &DynamicImage) -> Result<String, Box<dyn std::error::Error>> {
        // 1. Detection
        let (det_boxes, scale_x, scale_y) = self.detect(img)?;

        if det_boxes.is_empty() {
            return Ok("".to_string());
        }

        // Sort boxes
        let mut boxes = det_boxes;
        boxes.sort_by(|a, b| {
            if (a.y as i32 - b.y as i32).abs() < 10 {
                a.x.cmp(&b.x)
            } else {
                a.y.cmp(&b.y)
            }
        });

        // 2. Recognition for each box
        let mut results = Vec::new();
        for rect in boxes {
            // Un-scale boxes
            let orig_x = (rect.x as f32 / scale_x) as u32;
            let orig_y = (rect.y as f32 / scale_y) as u32;
            let orig_w = (rect.w as f32 / scale_x) as u32;
            let orig_h = (rect.h as f32 / scale_y) as u32;

            // Boundary checks
            let (img_w, img_h) = img.dimensions();
            let x = orig_x.min(img_w - 1);
            let y = orig_y.min(img_h - 1);
            let w = orig_w.min(img_w - x);
            let h = orig_h.min(img_h - y);

            if w < 5 || h < 5 {
                continue;
            }

            let crop = img.crop_imm(x, y, w, h);

            let text = self.recognize_line(&crop)?;
            if !text.trim().is_empty() {
                results.push(text);
            }
        }

        // Simple join
        let raw_text = results.join("\n");

        // 日本語のスペース除去処理
        let mut cleaned = String::with_capacity(raw_text.len());
        let chars: Vec<char> = raw_text.chars().collect();
        for i in 0..chars.len() {
            let c = chars[i];
            if c.is_whitespace() {
                if c == '\n' {
                    cleaned.push(c);
                    continue;
                }
                let prev = if i > 0 { chars[i - 1] } else { 'a' };
                let next = if i + 1 < chars.len() {
                    chars[i + 1]
                } else {
                    'a'
                };

                if (prev as u32) > 0x2000 && (next as u32) > 0x2000 {
                    continue;
                }
            }
            cleaned.push(c);
        }

        Ok(cleaned)
    }

    fn detect(
        &mut self,
        img: &DynamicImage,
    ) -> Result<(Vec<Rect>, f32, f32), Box<dyn std::error::Error>> {
        let (w, h) = img.dimensions();
        let limit_side_len = 960;
        let mut ratio = 1.0;
        if w.max(h) > limit_side_len {
            if h > w {
                ratio = limit_side_len as f32 / h as f32;
            } else {
                ratio = limit_side_len as f32 / w as f32;
            }
        }
        let mut resize_h = (h as f32 * ratio) as u32;
        let mut resize_w = (w as f32 * ratio) as u32;
        resize_h = (resize_h as i32 / 32 * 32) as u32;
        resize_w = (resize_w as i32 / 32 * 32) as u32;
        let resized = img.resize_exact(resize_w, resize_h, FilterType::Triangle);
        let scale_x = resize_w as f32 / w as f32;
        let scale_y = resize_h as f32 / h as f32;

        let input_tensor = self.preprocess_det(&resized)?;

        // Run Det
        // FIX: pass by value (move input_tensor) because OwnedTensorArrayData requires it
        let input_value = ort::value::Tensor::from_array(input_tensor)?;
        // FIX: remove ? after inputs!
        let outputs = self.det_session.run(ort::inputs!["x" => input_value])?;

        let (shape, data) = outputs["sigmoid_0.tmp_0"].try_extract_tensor::<f32>()?;
        let out_h = shape[2] as usize;
        let out_w = shape[3] as usize;

        let boxes = Self::find_contours(data, out_w, out_h, 0.3);

        Ok((boxes, scale_x, scale_y))
    }

    fn find_contours(data: &[f32], w: usize, h: usize, thresh: f32) -> Vec<Rect> {
        let mut visited = vec![false; w * h];
        let mut rects = Vec::new();
        let mut queue = std::collections::VecDeque::new();

        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                if data[idx] > thresh && !visited[idx] {
                    // BFS
                    let mut min_x = x;
                    let mut max_x = x;
                    let mut min_y = y;
                    let mut max_y = y;

                    queue.push_back((x, y));
                    visited[idx] = true;

                    while let Some((cx, cy)) = queue.pop_front() {
                        if cx < min_x {
                            min_x = cx;
                        }
                        if cx > max_x {
                            max_x = cx;
                        }
                        if cy < min_y {
                            min_y = cy;
                        }
                        if cy > max_y {
                            max_y = cy;
                        }

                        let neighbors = [
                            (cx.wrapping_sub(1), cy),
                            (cx + 1, cy),
                            (cx, cy.wrapping_sub(1)),
                            (cx, cy + 1),
                        ];

                        for (nx, ny) in neighbors {
                            if nx < w && ny < h {
                                let n_idx = ny * w + nx;
                                if !visited[n_idx] && data[n_idx] > thresh {
                                    visited[n_idx] = true;
                                    queue.push_back((nx, ny));
                                }
                            }
                        }
                    }

                    let box_w = max_x - min_x + 1;
                    let box_h = max_y - min_y + 1;

                    if box_w > 5 && box_h > 5 {
                        rects.push(Rect {
                            x: min_x as u32,
                            y: min_y as u32,
                            w: box_w as u32,
                            h: box_h as u32,
                        });
                    }
                }
            }
        }
        rects
    }

    fn recognize_line(&mut self, img: &DynamicImage) -> Result<String, Box<dyn std::error::Error>> {
        let (w, h) = img.dimensions();
        let h_target = 48;
        let scale = h_target as f32 / h as f32;
        let mut w_target = (w as f32 * scale) as u32;
        if w_target == 0 {
            w_target = 1;
        }
        let resized = img.resize_exact(w_target, h_target, FilterType::Triangle);
        let input_tensor = self.preprocess_rec(&resized)?;

        // Run Rec
        // FIX: pass by value
        let input_value = ort::value::Tensor::from_array(input_tensor)?;
        // FIX: remove ?
        let outputs = self.rec_session.run(ort::inputs!["x" => input_value])?;

        let (shape, data) = outputs["softmax_0.tmp_0"].try_extract_tensor::<f32>()?;

        let time_steps = shape[1] as usize;
        let num_classes = shape[2] as usize;

        let mut text = String::new();
        let mut last_idx = 0;
        let blank = 0;

        for t in 0..time_steps {
            let offset = t * num_classes;
            let step_data = &data[offset..offset + num_classes];

            // Argmax
            let (max_idx, _val) = step_data
                .iter()
                .enumerate()
                .max_by(|(_, a): &(_, &f32), (_, b): &(_, &f32)| a.partial_cmp(b).unwrap())
                .unwrap();

            if max_idx != last_idx {
                if max_idx != blank && max_idx < self.keys.len() {
                    text.push_str(self.keys[max_idx].as_str());
                }
                last_idx = max_idx;
            }
        }
        Ok(text)
    }

    fn preprocess_det(
        &self,
        img: &DynamicImage,
    ) -> Result<Array4<f32>, Box<dyn std::error::Error>> {
        let (w, h) = img.dimensions();
        let mut array = Array4::<f32>::zeros((1, 3, h as usize, w as usize));

        let mean = [0.485, 0.456, 0.406];
        let std = [0.229, 0.224, 0.225];

        for (x, y, px) in img.pixels() {
            let r = (px[0] as f32 / 255.0 - mean[0]) / std[0];
            let g = (px[1] as f32 / 255.0 - mean[1]) / std[1];
            let b = (px[2] as f32 / 255.0 - mean[2]) / std[2];

            array[[0, 0, y as usize, x as usize]] = r;
            array[[0, 1, y as usize, x as usize]] = g;
            array[[0, 2, y as usize, x as usize]] = b;
        }
        Ok(array)
    }

    fn preprocess_rec(
        &self,
        img: &DynamicImage,
    ) -> Result<Array4<f32>, Box<dyn std::error::Error>> {
        let (w, h) = img.dimensions();
        let mut array = Array4::<f32>::zeros((1, 3, h as usize, w as usize));

        for (x, y, px) in img.pixels() {
            let r = (px[0] as f32 / 255.0 - 0.5) / 0.5;
            let g = (px[1] as f32 / 255.0 - 0.5) / 0.5;
            let b = (px[2] as f32 / 255.0 - 0.5) / 0.5;

            array[[0, 0, y as usize, x as usize]] = r;
            array[[0, 1, y as usize, x as usize]] = g;
            array[[0, 2, y as usize, x as usize]] = b;
        }
        Ok(array)
    }
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}
