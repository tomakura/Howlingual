import onnx

m = onnx.load(r'c:\Users\Flow\Antigravity\Howlingual\src-tauri\resources\japan_PP-OCRv3_rec_infer.onnx')
chars = [p.value for p in m.metadata_props if p.key == 'character'][0]
lines = chars.split('\n')
print(f'Total characters in model: {len(lines)}')

with open(r'c:\Users\Flow\Antigravity\Howlingual\src-tauri\resources\japan_dict_from_model.txt', 'w', encoding='utf-8') as f:
    f.write(chars)
    
print('Dictionary extracted and saved!')
