import onnx

m = onnx.load(r'c:\Users\Flow\Antigravity\Howlingual\src-tauri\resources\japan_PP-OCRv5_rec_infer.onnx')

# Get character dictionary from metadata if available
try:
    chars = [p.value for p in m.metadata_props if p.key == 'character'][0]
    char_list = chars.split('\n')
    print(f'Metadata characters: {len(char_list)}')
except:
    print('No character metadata found.')
    char_list = []

# Get output shape
output_tensor = m.graph.output[0]
output_shape = [d.dim_value if d.dim_value > 0 else -1 for d in output_tensor.type.tensor_type.shape.dim]
print(f'\nModel output shape: {output_shape}')

# Get input shape
input_tensor = m.graph.input[0]
input_shape = [d.dim_value if d.dim_value > 0 else -1 for d in input_tensor.type.tensor_type.shape.dim]
print(f'Model input shape: {input_shape}')
num_classes = output_shape[-1]
print(f'Model num_classes: {num_classes}')

# Check local dictionary
try:
    with open(r'c:\Users\Flow\Antigravity\Howlingual\src-tauri\resources\japan_dict_v5.txt', 'r', encoding='utf-8') as f:
        local_keys = [line.strip() for line in f.readlines()]
    print(f'\nLocal dictionary keys: {len(local_keys)}')
    
    diff = num_classes - len(local_keys)
    print(f'Difference (Model - Dict): {diff}')
    
    if diff == 1:
        print('Likely: Dictionary + 1 Blank (Standard)')
    elif diff == 2:
        print('Likely: Dictionary + 1 Blank + 1 Space')
    else:
        print(f'Mismatch! Need {num_classes} keys, have {len(local_keys)}')
except Exception as e:
    print(f'Could not read local dictionary: {e}')
