import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../../components/ui';
import { parseScan } from '../../lib/scan';
import s from './lab.module.css';

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/**
 * Reads QR codes with the built-in BarcodeDetector (Android Chrome) or,
 * where it is missing (iPhone, Firefox), with jsQR loaded on demand.
 */
async function makeReader(): Promise<(video: HTMLVideoElement) => Promise<string | null>> {
  const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (Ctor) {
    const d = new Ctor({ formats: ['qr_code'] });
    return async (video) => (await d.detect(video))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return null;
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return 'Немає дозволу на камеру. Дозвольте його в налаштуваннях браузера або введіть код вручну.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Камеру не знайдено. Введіть код з наліпки вручну.';
  return 'Не вдалося увімкнути камеру. Введіть код з наліпки вручну.';
}

export function ScanPage() {
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [foreign, setForeign] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const go = (text: string) => {
      const target = parseScan(text, location.origin);
      if (!target) {
        setForeign(true);
        return false;
      }
      void navigate(`/lab/${encodeURIComponent(target.code)}`);
      return true;
    };
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Камера працює лише через захищене з’єднання (https). Введіть код вручну.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const read = await makeReader();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const text = await read(video.current);
            if (text && go(text)) return;
          } catch {
            // A frame that cannot be read; try the next one.
          }
          timer = setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch (e) {
        if (!stopped) setError(cameraError(e));
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [navigate]);

  const onManual = (e: FormEvent) => {
    e.preventDefault();
    const target = parseScan(code, location.origin);
    if (target) void navigate(`/lab/${encodeURIComponent(target.code)}`);
    else setForeign(true);
  };

  return (
    <>
      <PageHeader title="Сканувати QR" />
      {!error && (
        <div className={s.viewfinder}>
          <video ref={video} muted playsInline aria-label="Камера" />
          <span className={s.frame} aria-hidden="true" />
        </div>
      )}
      <p className="hint">{error ?? 'Наведіть камеру на QR-наліпку обладнання.'}</p>
      {foreign && <p role="alert" className={s.warn}>Цей код не з DigiComp HUB. Перевірте наліпку.</p>}
      <form className={s.manual} onSubmit={onManual} noValidate>
        <div className="field">
          <label htmlFor="scan-code">Код з наліпки</label>
          <input
            id="scan-code"
            autoCapitalize="characters"
            placeholder="CNC-1"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setForeign(false);
            }}
          />
        </div>
        <button type="submit" className="btn" disabled={!code.trim()}>
          Відкрити
        </button>
      </form>
    </>
  );
}
