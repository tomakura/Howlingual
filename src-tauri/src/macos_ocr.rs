#[cfg(target_os = "macos")]
use image::DynamicImage;
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::ClassType;
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSData, NSDictionary, NSString}; // Removed NSError
#[cfg(target_os = "macos")]
use objc2_vision::{
    VNImageRequestHandler, VNRecognizeTextRequest, VNRecognizedTextObservation, VNRequest,
    VNRequestTextRecognitionLevel,
};

#[cfg(target_os = "macos")]
pub fn perform_ocr(img: DynamicImage) -> Result<String, String> {
    use std::ffi::c_void;
    use std::io::Cursor;

    log::info!(
        "[macos_ocr] perform_ocr called. Image: {}x{}",
        img.width(),
        img.height()
    );

    // 1. Convert DynamicImage to PNG bytes (NSData)
    let mut bytes: Vec<u8> = Vec::new();
    img.write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode image: {}", e))?;

    log::info!("[macos_ocr] Image encoded to PNG. Bytes: {}", bytes.len());

    // Create NSData
    // NSData::from/with_bytes methods were missing, so using explicit init.
    // initWithBytes_length copies data.
    let ns_data = unsafe {
        NSData::initWithBytes_length(NSData::alloc(), bytes.as_ptr() as *mut c_void, bytes.len())
    };
    log::info!("[macos_ocr] NSData created. Length: {}", ns_data.length());

    // 2. Create Request Handler
    // alloc() returns Allocated<Self> (owned), init consumes it.
    let handler = unsafe {
        VNImageRequestHandler::initWithData_options(
            VNImageRequestHandler::alloc(), // No borrow
            &ns_data,
            &NSDictionary::new(),
        )
    };

    // 3. Create Request
    let request = unsafe { VNRecognizeTextRequest::new() };
    unsafe {
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        request.setUsesLanguageCorrection(true);
        let languages = NSArray::from_vec(vec![
            NSString::from_str("ja-JP"),
            NSString::from_str("en-US"),
        ]);
        request.setRecognitionLanguages(&languages);
    }

    // Upcast to VNRequest for the array
    // VNRecognizeTextRequest -> VNImageBasedRequest -> VNRequest
    // Using unsafe transmute to treat Retained<VNRecognizeTextRequest> as Retained<VNRequest>
    let request_ptr: Retained<VNRequest> = unsafe { std::mem::transmute(request.clone()) };

    // 4. Perform Request
    let requests = NSArray::from_vec(vec![request_ptr]);

    // performRequests_error returns Result<(), Retained<NSError>> in modern bindings
    log::info!("[macos_ocr] Performing Vision request...");
    let result = unsafe { handler.performRequests_error(&requests) };

    if let Err(e) = result {
        log::info!(
            "[macos_ocr] Vision request FAILED: {}",
            e.localizedDescription()
        );
        return Err(format!(
            "Vision request failed: {}",
            e.localizedDescription()
        ));
    }

    // 5. Process Results (from original request object)
    let results = unsafe { request.results() };
    if results.is_none() {
        log::info!("[macos_ocr] No results found (results is None).");
        return Ok(String::new());
    }
    let results = results.unwrap();

    let mut full_text = String::new();

    let count = results.count();
    log::info!("[macos_ocr] Observations found: {}", count);

    for i in 0..count {
        let obs: Retained<VNRecognizedTextObservation> = unsafe { results.objectAtIndex(i) };
        let candidates = unsafe { obs.topCandidates(1) };
        if candidates.count() > 0 {
            let candidate = unsafe { candidates.objectAtIndex(0) };
            let text = unsafe { candidate.string() };
            // println!("[macos_ocr] candidate: {}", text); // verbose
            if !full_text.is_empty() {
                full_text.push('\n');
            }
            full_text.push_str(&text.to_string());
        }
    }

    log::info!("[macos_ocr] Final text length: {}", full_text.len());
    Ok(full_text)
}
