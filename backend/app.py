from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
from deepface import DeepFace
from insightface.app import FaceAnalysis
from collections import Counter

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize InsightFace
insightface_app = FaceAnalysis(name='buffalo_l')
insightface_app.prepare(ctx_id=0)  # 0 for GPU, -1 for CPU

def analyze_image(img, age_threshold=40):
    try:
        df_result = DeepFace.analyze(
            img_path=img,
            actions=['age', 'emotion'],
            enforce_detection=False
        )
        df_result = df_result[0]  # Assuming single face
        deepface_age = df_result['age']
        deepface_emotion = df_result['dominant_emotion']
        df_confidence = df_result.get('face_confidence', 0.5)
    except Exception as e:
        return {"error": f"DeepFace analyze failed: {str(e)}"}

    try:
        faces = insightface_app.get(img)
        if not faces:
            return {"error": "No face detected with InsightFace"}
        insightface_age = faces[0].age
        insightface_conf = faces[0].det_score
    except Exception as e:
        return {"error": f"InsightFace failed: {str(e)}"}

    try:
        total_conf = df_confidence + insightface_conf
        deepface_weight = df_confidence / total_conf
        insightface_weight = insightface_conf / total_conf
        fused_age = round((deepface_age * deepface_weight) + (insightface_age * insightface_weight), 1)

        if fused_age < age_threshold:
            deepface_weight = min(0.8, deepface_weight * 1.5)
            insightface_weight = max(0.2, 1 - deepface_weight)
        else:
            insightface_weight = min(0.8, insightface_weight * 1.5)
            deepface_weight = max(0.2, 1 - deepface_weight)
        fused_age = round((deepface_age * deepface_weight) + (insightface_age * insightface_weight), 1)
    except Exception as e:
        fused_age = deepface_age if deepface_age < age_threshold else insightface_age
        deepface_weight = 1.0 if fused_age == deepface_age else 0.0
        insightface_weight = 1.0 - deepface_weight

    return {
        "fused_age": fused_age,
        "deepface_age": deepface_age,
        "insightface_age": insightface_age,
        "deepface_conf": df_confidence,
        "insightface_conf": insightface_conf,
        "emotion": deepface_emotion
    }

@app.post("/analyze")
async def analyze(files: list[UploadFile] = File(...)):
    results = []
    for file in files:
        image_bytes = await file.read()
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        result = analyze_image(img)
        if "error" in result:
            return JSONResponse(content=result, status_code=400)
        results.append(result)
    
    if not results:
        return {"error": "No images processed"}

    fused_ages = [r['fused_age'] for r in results]
    deepface_ages = [r['deepface_age'] for r in results]
    insightface_ages = [r['insightface_age'] for r in results]
    emotions = [r['emotion'] for r in results]
    deepface_confs = [r['deepface_conf'] for r in results]
    insightface_confs = [r['insightface_conf'] for r in results]

    avg_fused_age = float(sum(fused_ages) / len(fused_ages))  # Convert to native float
    avg_deepface_age = float(sum(deepface_ages) / len(deepface_ages))  # Convert to native float
    avg_insightface_age = float(sum(insightface_ages) / len(insightface_ages))  # Convert to native float
    avg_deepface_conf = float(sum(deepface_confs) / len(deepface_confs))  # Convert to native float
    avg_insightface_conf = float(sum(insightface_confs) / len(insightface_confs))  # Convert to native float

    emotion_counter = Counter(emotions)
    dominant_emotion = emotion_counter.most_common(1)[0][0]

    return {
        "final_insightface_age": round(avg_insightface_age, 2),
        "final_insightface_conf": round(avg_insightface_conf, 2),
        "final_deepface_age": round(avg_deepface_age, 2),
        "final_deepface_conf": round(avg_deepface_conf, 2),
        "final_fused_age": round(avg_fused_age, 2),
        "dominant_emotion": dominant_emotion
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)