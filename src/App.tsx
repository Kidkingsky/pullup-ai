import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import { PullupAnalyzer, type PullupAnalysis } from './pullupAnalyzer';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

const emptyAnalysis: PullupAnalysis = {
  phase: 'SEARCHING',
  repCount: 0,
  leftElbow: 0,
  rightElbow: 0,
  avgElbow: 0,
  bodySwing: 0,
  score: 0,
  feedback: ['等待開始'],
  goodRepFlash: false,
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const analyzerRef = useRef(new PullupAnalyzer());
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const [status, setStatus] = useState('載入 AI 模型中…');
  const [running, setRunning] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [analysis, setAnalysis] = useState<PullupAnalysis>(emptyAnalysis);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let disposed = false;
    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.55,
          minPosePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
        if (!disposed) {
          landmarkerRef.current = landmarker;
          setStatus('AI 已就緒');
        } else {
          landmarker.close();
        }
      } catch (err) {
        console.error(err);
        setStatus('AI 模型載入失敗');
      }
    }
    init();
    return () => {
      disposed = true;
      stopCamera();
      landmarkerRef.current?.close();
    };
  }, []);

  async function startCamera(mode = facingMode) {
    if (!landmarkerRef.current) {
      setStatus('AI 還在載入');
      return;
    }
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      analyzerRef.current.reset();
      setAnalysis(emptyAnalysis);
      setRunning(true);
      setStatus('偵測中');
      lastVideoTimeRef.current = -1;
      renderLoop();
    } catch (err) {
      console.error(err);
      setStatus('無法開啟相機，請確認權限與 HTTPS');
    }
  }

  function stopCamera() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
  }

  async function switchCamera() {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    if (running) await startCamera(next);
  }

  function resetWorkout() {
    analyzerRef.current.reset();
    setAnalysis(emptyAnalysis);
  }

  function renderLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const pose = landmarkerRef.current;
    if (!video || !canvas || !pose || !streamRef.current) return;

    if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh && (canvas.width !== vw || canvas.height !== vh)) {
        canvas.width = vw;
        canvas.height = vh;
      }
      const result = pose.detectForVideo(video, performance.now());
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (result.landmarks.length > 0) {
        const landmarks = result.landmarks[0];
        const next = analyzerRef.current.analyze(landmarks);
        setAnalysis(next);
        if (next.goodRepFlash) {
          setFlash(true);
          window.setTimeout(() => setFlash(false), 350);
        }
        const drawing = new DrawingUtils(ctx);
        const quality = next.score;
        drawing.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
          color: quality >= 80 ? '#55f28a' : quality >= 60 ? '#ffd85a' : '#ff6577',
          lineWidth: 5,
        });
        drawing.drawLandmarks(landmarks, {
          color: '#ffffff', fillColor: '#0a0f18', radius: 4, lineWidth: 2,
        });
      } else {
        setAnalysis((prev) => ({ ...prev, feedback: ['沒有偵測到完整人體'], score: 0 }));
      }
    }
    rafRef.current = requestAnimationFrame(renderLoop);
  }

  return (
    <main className="app">
      <section className="camera-shell">
        <video ref={videoRef} className={`camera ${facingMode === 'user' ? 'mirror' : ''}`} playsInline muted />
        <canvas ref={canvasRef} className={`overlay ${facingMode === 'user' ? 'mirror' : ''}`} />

        <div className="topbar">
          <div>
            <div className="eyebrow">PULL-UP AI</div>
            <div className="status"><span className={running ? 'dot live' : 'dot'} />{status}</div>
          </div>
          <button className="icon-btn" onClick={switchCamera} aria-label="切換鏡頭">↻</button>
        </div>

        <div className={`rep-card ${flash ? 'rep-flash' : ''}`}>
          <span>REP</span><strong>{String(analysis.repCount).padStart(2, '0')}</strong>
        </div>

        <div className="phase-pill">{phaseLabel(analysis.phase)}</div>

        <div className="bottom-panel">
          <div className="score-row">
            <div><small>動作品質</small><div className="score">{analysis.score}</div></div>
            <div className="angle-box"><span>L {analysis.leftElbow}°</span><span>R {analysis.rightElbow}°</span></div>
          </div>
          <div className="meter"><div className="meter-fill" style={{ width: `${analysis.score}%` }} /></div>
          <div className="feedback">
            {analysis.feedback.slice(0, 2).map((item, i) => (
              <div className="feedback-item" key={`${item}-${i}`}><span>{item === '動作穩定' ? '✓' : '!'}</span>{item}</div>
            ))}
          </div>
          <div className="diagnostics"><span>肘角 {analysis.avgElbow}°</span><span>擺盪 {analysis.bodySwing}</span></div>
          <div className="actions">
            {!running ? <button className="primary" onClick={() => startCamera()}>開始訓練</button> : <button className="primary danger" onClick={stopCamera}>結束</button>}
            <button className="secondary" onClick={resetWorkout}>歸零</button>
          </div>
        </div>
      </section>
    </main>
  );
}

function phaseLabel(phase: PullupAnalysis['phase']) {
  switch (phase) {
    case 'BOTTOM': return 'READY · 手臂伸直';
    case 'PULLING': return 'PULL · 拉起';
    case 'TOP': return 'TOP · 到頂';
    case 'LOWERING': return 'DOWN · 下放';
    default: return '請讓全身進入畫面';
  }
}
