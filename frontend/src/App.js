import React, { useRef, useEffect, useState } from 'react';
import Webcam from 'react-webcam';
import { FaceLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import axios from 'axios';

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    let faceLandmarker;
    let camera;

    const initializeFaceLandmarker = async () => {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
        );
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: 'GPU'
          },
          outputFaceBlendshapes: true,
          runningMode: 'VIDEO',
          numFaces: 1
        });

        const video = webcamRef.current?.video;
        if (!video) return;

        let lastVideoTime = -1;
        const predictWebcam = async () => {
          if (!running || !video || !canvasRef.current) return;
          if (video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            const startTimeMs = performance.now();
            const results = faceLandmarker.detectForVideo(video, startTimeMs);
            const canvasElement = canvasRef.current;
            canvasElement.width = video.videoWidth;
            canvasElement.height = video.videoHeight;
            const canvasCtx = canvasElement.getContext('2d');
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            const drawingUtils = new DrawingUtils(canvasCtx);
            if (results.faceLandmarks) {
              for (const landmarks of results.faceLandmarks) {
                drawingUtils.drawConnectors(
                  landmarks,
                  FaceLandmarker.FACE_LANDMARKS_TESSELATION,
                  { color: '#352e42', lineWidth: 1 }
                );
                drawingUtils.drawConnectors(
                  landmarks,
                  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
                  { color: 'white' }
                );
                drawingUtils.drawConnectors(
                  landmarks,
                  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
                  { color: 'black' }
                );
                drawingUtils.drawConnectors(
                  landmarks,
                  FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
                  { color: 'white' }
                );
                drawingUtils.drawConnectors(
                  landmarks,
                  FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
                  { color: 'black' }
                );
                drawingUtils.drawConnectors(
                  landmarks,
                  FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,n   fuck u
                  { color: '#352e42' }
                );
                drawingUtils.drawConnectors(
                  landmarks,
                  FaceLandmarker.FACE_LANDMARKS_LIPS,
                  { color: 'white' }
                );
              }
            }
          }
          window.requestAnimationFrame(predictWebcam);
        };

        navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
          video.srcObject = stream;
          video.onloadeddata = () => {
            video.play();
            predictWebcam();
          };
        });

        camera = {
          stop: () => {
            const stream = video.srcObject;
            if (stream) {
              stream.getTracks().forEach(track => track.stop());
            }
            video.srcObject = null;
          }
        };
      } catch (error) {
        console.error('FaceLandmarker initialization failed:', error);
      }
    };

    if (running) {
      initializeFaceLandmarker();
    }

    return () => {
      setRunning(false);
      if (camera) camera.stop();
      if (faceLandmarker) faceLandmarker.close();
    };
  }, [running]);

  useEffect(() => {
    if (status === 'results') {
      setRunning(false);
    } else {
      setRunning(true);
    }
  }, [status]);

  const startAnalysis = () => {
    setStatus('analyzing');
    captureImages();
  };

  const captureImages = () => {
    const images = [];
    const interval = 500; // 0.5 seconds
    const totalTime = 5000; // 10 seconds
    const numCaptures = 10;
    let captureCount = 0;

    const captureInterval = setInterval(() => {
      if (captureCount < numCaptures) {
        const screenshot = webcamRef.current.getScreenshot();
        if (screenshot) {
          images.push(screenshot);
          captureCount++;
        }
      } else {
        clearInterval(captureInterval);
        sendToBackend(images);
      }
    }, interval);

    setTimeout(() => {
      clearInterval(captureInterval);
      if (captureCount < numCaptures) {
        console.warn('Not all images captured');
      }
      sendToBackend(images);
    }, totalTime);
  };

  const sendToBackend = async (images) => {
    const formData = new FormData();
    images.forEach((image, index) => {
      const byteString = atob(image.split(',')[1]);
      const mimeString = image.split(',')[0].split(':')[1].split(';')[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mimeString });
      formData.append('files', blob, `image${index}.jpg`);
    });

    try {
      const response = await axios.post('http://localhost:8000/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResults(response.data);
      setStatus('results');
    } catch (error) {
      console.error('Error sending images to backend:', error);
      setStatus('idle');
    }
  };

  if (status === 'results') {
    return (
      <div style={{ textAlign: 'center', padding: '20px' }}>
        <h2>Analysis Results</h2>
        <p>InsightFace Age: {results?.final_insightface_age} (Confidence: {(results?.final_insightface_conf * 100).toFixed(2)}%)</p>
        <p>DeepFace Age: {results?.final_deepface_age} (Confidence: {(results?.final_deepface_conf * 100).toFixed(2)}%)</p>
        <p>Fused Age: {results?.final_fused_age}</p>
        <p>Dominant Emotion: {results?.dominant_emotion}</p>
        <button
          onClick={() => setStatus('idle')}
          style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer' }}
        >
          Reanalyze
        </button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <h1>FaceAge_v5 Frontend</h1>
      <div style={{ position: 'relative', width: '640px', height: '480px', margin: '0 auto' }}>
        <Webcam
          ref={webcamRef}
          style={{ width: '100%', height: '100%' }}
          videoConstraints={{ facingMode: 'user' }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
          }}
        />
      </div>
      {status === 'idle' && (
        <button
          onClick={startAnalysis}
          style={{ padding: '10px 20px', fontSize: '16px', marginTop: '10px', cursor: 'pointer' }}
        >
          Start Analysis
        </button>
      )}
      {status === 'analyzing' && (
        <p style={{ marginTop: '10px' }}>Analyzing... Please wait.</p>
      )}
    </div>
  );
}

export default App;