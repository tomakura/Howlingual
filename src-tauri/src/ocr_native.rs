use image::DynamicImage;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

pub struct WindowsOcr {
    engine: OcrEngine,
}

impl WindowsOcr {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let lang = Language::CreateLanguage(&windows::core::HSTRING::from("ja-JP"))?;

        // Check availability
        if !OcrEngine::IsLanguageSupported(&lang)? {
            return Err("Japanese OCR is not supported on this Windows system. Please install the Japanese language pack.".into());
        }

        let engine = OcrEngine::TryCreateFromLanguage(&lang)?;
        // engine might be null/None if creation failed despite check, but windows crate usually returns Result
        // TryCreateFromLanguage returns Result<OcrEngine>; check if it needs unwrapping or similar handling?
        // Actually TryCreateFromLanguage returns Result<OcrEngine>.

        Ok(Self { engine })
    }

    pub fn recognize(&self, img: &DynamicImage) -> Result<String, Box<dyn std::error::Error>> {
        let (w, h) = (img.width(), img.height());
        let rgba = img.to_rgba8();
        // Create SoftwareBitmap from byte buffer (IBuffer)
        // windows::Storage::Streams::DataWriter is the easiest way to create an IBuffer from bytes.
        let data_writer = DataWriter::new()?;
        data_writer.WriteBytes(&rgba)?;
        let ibuffer = data_writer.DetachBuffer()?;

        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &ibuffer,
            BitmapPixelFormat::Rgba8,
            w as i32,
            h as i32,
        )?;

        let result = self.engine.RecognizeAsync(&bitmap)?.get()?;
        let text = result.Text()?.to_string();

        // Remove unwanted spaces between Japanese characters
        // Windows OCR tends to insert spaces between individual characters in Japanese text
        let cleaned = remove_japanese_spaces(&text);

        Ok(cleaned)
    }
}

/// Remove spaces between Japanese characters (Hiragana, Katakana, Kanji, and Japanese punctuation)
fn remove_japanese_spaces(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();

    for i in 0..chars.len() {
        let current = chars[i];

        // Check if current character is a space
        if current == ' ' || current == '\u{3000}' {
            // ASCII space or ideographic space
            // Check if we should keep this space
            let prev_is_japanese = if i > 0 {
                is_japanese_char(chars[i - 1])
            } else {
                false
            };

            let next_is_japanese = if i + 1 < chars.len() {
                is_japanese_char(chars[i + 1])
            } else {
                false
            };

            // Only keep space if:
            // - it's between non-Japanese characters
            // - or at boundaries (beginning/end being non-Japanese)
            if !prev_is_japanese || !next_is_japanese {
                result.push(current);
            }
            // Otherwise skip the space (between Japanese characters)
        } else {
            result.push(current);
        }
    }

    result
}

/// Check if a character is Japanese (Hiragana, Katakana, Kanji, or common Japanese punctuation)
fn is_japanese_char(c: char) -> bool {
    let code = c as u32;
    matches!(code,
        0x3040..=0x309F | // Hiragana
        0x30A0..=0x30FF | // Katakana
        0x4E00..=0x9FAF | // CJK Unified Ideographs (Kanji)
        0x3400..=0x4DBF | // CJK Extension A
        0xFF00..=0xFFEF   // Fullwidth forms
    ) || matches!(
        c,
        '。' | '、' | '・' | '「' | '」' | '『' | '』' | '（' | '）' | '！' | '？'
    )
}
