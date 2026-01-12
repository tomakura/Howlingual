import onnxruntime as ort
import numpy as np
import cv2
import os

def check_inference():
    model_path = r'src-tauri/resources/japan_PP-OCRv5_rec_infer.onnx'
    dict_path = r'src-tauri/resources/japan_dict_v5.txt'
    # Use the uploaded image for testing
    image_path = r'C:/Users/Flow/.gemini/antigravity/brain/e42659a9-cfd4-49d6-aebd-0b2f3e8a0f78/uploaded_image_1768235871753.png'

    print(f"Loading model: {model_path}")
    session = ort.InferenceSession(model_path)
    
    print(f"Loading dictionary: {dict_path}")
    with open(dict_path, 'r', encoding='utf-8') as f:
        keys = [line.strip() for line in f.readlines()]
    # Add blank/space as per our logic
    keys.append(" ")
    keys.append("blank")
    print(f"Dictionary size: {len(keys)}")

    # Preprocess
    if not os.path.exists(image_path):
        print(f"Image not found: {image_path}")
        return

    img = cv2.imread(image_path)
    # Take a crop similar to what we might send strictly to Rec model
    # For test, just use the whole image or a central crop if it's a screenshot
    # Assuming the user uploaded a cropped text area?
    
    h, w = img.shape[:2]
    # Resize to height 48, keep aspect ratio
    rec_h = 48
    ratio = rec_h / float(h)
    rec_w = int(w * ratio)
    resized = cv2.resize(img, (rec_w, rec_h))
    
    # Normalize (0.5, 0.5, 0.5)
    resized = resized.astype(np.float32) / 255.0
    resized = (resized - 0.5) / 0.5
    
    # Transpose [H, W, C] -> [1, C, H, W]
    resized = resized.transpose(2, 0, 1)
    input_tensor = resized[np.newaxis, :]
    
    print(f"Input shape: {input_tensor.shape}")
    
    # Run
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: input_tensor})
    output_tensor = outputs[0] # [batch, time, classes]
    
    print(f"Output shape: {output_tensor.shape}")
    
    # Decode
    preds = output_tensor[0] # [time, classes]
    pred_indices = np.argmax(preds, axis=1)
    
    text = ""
    last_idx = len(keys) - 1 # blank
    
    for idx in pred_indices:
        if idx != last_idx:
            if idx < len(keys):
                text += keys[idx]
            last_idx = idx
        else:
            last_idx = idx
            
    print(f"Raw indices: {pred_indices[:20]}...")
    print(f"Decoded text: {text}")

if __name__ == "__main__":
    check_inference()
