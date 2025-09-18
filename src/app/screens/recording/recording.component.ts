// recording.component.ts (versão otimizada)
import {
  Component, ElementRef, ViewChild, OnDestroy, OnInit, CUSTOM_ELEMENTS_SCHEMA, inject, PLATFORM_ID
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { VideoService } from '../../services/video.service';

@Component({
  selector: 'app-recording',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recording.component.html',
  styleUrls: ['./recording.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class RecordingComponent implements OnInit, OnDestroy {
  // UI
  recording = false;
  showChoice = false;
  recordedBlob?: Blob;

  // DOM
  @ViewChild('container', { static: true }) containerRef!: ElementRef<HTMLDivElement>;

  // Runtime
  private platformId = inject(PLATFORM_ID);
  private rafId?: number;

  // Elements
  private previewVideo?: HTMLVideoElement; // <video> cru, só pro start rápido
  private camVideo?: HTMLVideoElement;     // mesmo do preview
  private bgVideo?: HTMLVideoElement;      // vídeo de fundo

  private inputCanvas?: HTMLCanvasElement; // webcam rotacionada → retrato
  private inputCtx?: CanvasRenderingContext2D | null;

  private compositeCanvas?: HTMLCanvasElement; // canvas final (exibido + gravado)
  private compositeCtx?: CanvasRenderingContext2D | null;

  // Buffers “estáticos” (pré-renderizados, NÃO por frame)
  private staticMatte?: HTMLCanvasElement;     // máscara soft da janela (feather aplicado 1x)
  private staticOutline?: HTMLCanvasElement;   // contorno soft pronto (aplicado 1x)
  private windowPath?: Path2D;                 // path reutilizável da janela em arco

  // Recorder
  private mediaRecorder?: MediaRecorder;
  private chunks: Blob[] = [];

  // Flags
  private haveEffect = false;

  // --------------------------------------------------------------------------
  // Config
  private readonly W = 1440;
  private readonly H = 1920;
  private readonly FPS = 30;                 // trava o loop a 30 fps
  private readonly ROTATE_CLOCKWISE = true;
  private readonly MIRROR = false;

  // Janela em arco
  private readonly USE_FIXED_WINDOW = true;
  private readonly WINDOW_X = 582;
  private readonly WINDOW_Y = 690;
  private readonly WINDOW_W = 275;
  private readonly WINDOW_H = 810;
  private readonly WINDOW_ARCH_RADIUS = this.WINDOW_W / 2;

  // Qualidade (aplicados SÓ uma vez)
  private readonly FEATHER_PX = 2; // suavização da borda
  private readonly OUTLINE_WIDTH = 8;
  private readonly OUTLINE_COLOR = 'rgba(255,255,255,0.95)';
  private readonly OUTLINE_SOFTNESS = 1;

  constructor(
    private router: Router,
    private dataService: DataService,
    private videoService: VideoService
  ) {}

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.createElements();
    this.buildWindowPath();     // Path2D reutilizável
    this.buildStaticMasks();    // 👈 pré-renderiza matte + outline uma vez só

    await this.startCamera();
    await this.startBackgroundVideo();

    this.startLoop();           // loop capado a 30fps
  }

  ngOnDestroy() { this.stopAll(); }

  // --------------------------------------------------------------------------
  // Setup
  private createElements() {
    const container = this.containerRef.nativeElement;

    // Preview cru (fica oculto quando o efeito está pronto)
    this.previewVideo = document.createElement('video');
    this.previewVideo.className = 'preview-video';
    this.previewVideo.autoplay = true;
    this.previewVideo.playsInline = true;
    this.previewVideo.muted = true;
    container.appendChild(this.previewVideo);

    // Canvas final
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = this.W;
    this.compositeCanvas.height = this.H;
    this.compositeCanvas.className = 'composite-canvas';
    this.compositeCtx = this.compositeCanvas.getContext('2d', {
      alpha: true,
      desynchronized: true, // dica pro browser evitar sincronização pesada
    } as any) as CanvasRenderingContext2D | null;
    if (this.compositeCtx) {
      this.compositeCtx.imageSmoothingEnabled = true;
    }
    container.appendChild(this.compositeCanvas);

    // Canvas de entrada (webcam → retrato)
    this.inputCanvas = document.createElement('canvas');
    this.inputCanvas.width = this.W;
    this.inputCanvas.height = this.H;
    this.inputCtx = this.inputCanvas.getContext('2d', { desynchronized: true } as any) as CanvasRenderingContext2D | null;
    if (this.inputCtx) this.inputCtx.imageSmoothingEnabled = true;

    // Vídeo de fundo
    this.camVideo = this.previewVideo;
    this.bgVideo = document.createElement('video');
    this.bgVideo.src = 'assets/videos/background.mp4';
    this.bgVideo.loop = true;
    this.bgVideo.muted = true;
    this.bgVideo.playsInline = true;
  }

  private async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 30, max: 30 } // evita câmera jogando 60+ fps
      },
      audio: false
    });
    this.camVideo!.srcObject = stream;
    try { await this.camVideo!.play(); } catch {}
    await this.waitForVideo(this.camVideo!);
    this.layoutPreviewAsPortrait();
  }

  private layoutPreviewAsPortrait() {
    const v = this.previewVideo!;
    v.style.position = 'absolute';
    v.style.zIndex = '0';
    v.style.left = '50%';
    v.style.top = '50%';

    const rotateDeg = this.ROTATE_CLOCKWISE ? 90 : 0;
    const mirrorScale = this.MIRROR ? ' scaleX(-1)' : '';
    if (this.ROTATE_CLOCKWISE) {
      v.style.width = `${this.H}px`;   // 1920
      v.style.height = `${this.W}px`;  // 1440
    } else {
      v.style.width = '100%';
      v.style.height = '100%';
    }
    v.style.transformOrigin = 'center center';
    v.style.transform = `translate(-50%, -50%) rotate(${rotateDeg}deg)${mirrorScale}`;
    v.style.objectFit = 'cover';
    v.style.visibility = 'visible';
  }

  private async startBackgroundVideo() {
    try { await this.bgVideo!.play(); } catch {}
  }

  // --------------------------------------------------------------------------
  // Pré-renderização das máscaras/contornos (uma única vez)
  private buildWindowPath() {
    const p = new Path2D();
    const x = this.WINDOW_X, y = this.WINDOW_Y, w = this.WINDOW_W, h = this.WINDOW_H;
    const r = Math.max(1, Math.min(this.WINDOW_ARCH_RADIUS, w / 2));
    const cx = x + w / 2;
    const cy = y + r;

    p.moveTo(x, y + r);
    p.arc(cx, cy, r, Math.PI, 0, false);
    p.lineTo(x + w, y + h);
    p.lineTo(x, y + h);
    p.closePath();

    this.windowPath = p;
  }

  private buildStaticMasks() {
    // Matte (janela branca com feather aplicado)
    const matte = document.createElement('canvas');
    matte.width = this.W; matte.height = this.H;
    const mctx = matte.getContext('2d')!;
    mctx.clearRect(0, 0, this.W, this.H);
    mctx.fillStyle = '#fff';
    mctx.fill(this.windowPath!);

    if (this.FEATHER_PX > 0) {
      // aplica blur uma vez só
      const tmp = document.createElement('canvas');
      tmp.width = this.W; tmp.height = this.H;
      const tctx = tmp.getContext('2d')!;
      tctx.drawImage(matte, 0, 0);
      (mctx as any).filter = `blur(${this.FEATHER_PX}px)`;
      mctx.clearRect(0, 0, this.W, this.H);
      mctx.drawImage(tmp, 0, 0);
      (mctx as any).filter = 'none';
    }
    this.staticMatte = matte;

    // Outline (anel soft ao redor da janela)
    const outline = document.createElement('canvas');
    outline.width = this.W; outline.height = this.H;
    const octx = outline.getContext('2d')!;

    // base: janela “sólida”
    const base = document.createElement('canvas');
    base.width = this.W; base.height = this.H;
    const bctx = base.getContext('2d')!;
    bctx.fillStyle = '#fff';
    bctx.fill(this.windowPath!);

    // dilata via blur para espessura
    const blurForOutline = Math.max(1, this.OUTLINE_WIDTH);
    (octx as any).filter = `blur(${blurForOutline}px)`;
    octx.drawImage(base, 0, 0);
    (octx as any).filter = 'none';

    // pinta a área dilatada
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = this.OUTLINE_COLOR;
    octx.fillRect(0, 0, this.W, this.H);

    // remove interior da janela (fica só o anel)
    octx.globalCompositeOperation = 'destination-out';
    octx.drawImage(this.staticMatte, 0, 0);

    // amacia um tiquinho
    if (this.OUTLINE_SOFTNESS > 0) {
      const tmp2 = document.createElement('canvas');
      tmp2.width = this.W; tmp2.height = this.H;
      const t2 = tmp2.getContext('2d')!;
      t2.drawImage(outline, 0, 0);
      octx.globalCompositeOperation = 'copy';
      (octx as any).filter = `blur(${this.OUTLINE_SOFTNESS}px)`;
      octx.drawImage(tmp2, 0, 0);
      (octx as any).filter = 'none';
      octx.globalCompositeOperation = 'source-over';
    }
    this.staticOutline = outline;
  }

  // --------------------------------------------------------------------------
  // Loop limitado (30 FPS) — sem reconstruções por frame
  private lastTime = 0;
  private startLoop() {
    const step = (ts: number) => {
      const minDelta = 1000 / this.FPS;
      if (!this.lastTime || ts - this.lastTime >= minDelta) {
        this.lastTime = ts;
        this.frame();
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private frame() {
    // 1) atualizar inputCanvas com webcam já “retrato”
    this.drawRotatedWebcamIntoInput();

    // 2) compor
    const ctx = this.compositeCtx!;
    ctx.save();
    ctx.clearRect(0, 0, this.W, this.H);

    // Fundo
    if (this.bgVideo && this.bgVideo.readyState >= 2) {
      this.drawMediaContain(ctx, this.bgVideo, this.W, this.H);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.W, this.H);
    }

    // Contorno (pré-renderizado)
    if (this.staticOutline) {
      ctx.drawImage(this.staticOutline, 0, 0);
    }

    // Webcam dentro da janela (clip com Path2D reutilizado)
    ctx.save();
    ctx.clip(this.windowPath!);
    // “cover” dentro do retângulo da janela
    const srcW = this.inputCanvas!.width;
    const srcH = this.inputCanvas!.height;
    const winW = this.WINDOW_W;
    const winH = this.WINDOW_H;
    const winAR = winW / winH;
    const srcAR = srcW / srcH;
    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcAR > winAR) {
      const desiredW = srcH * winAR;
      sx = (srcW - desiredW) / 2;
      sw = desiredW;
    } else {
      const desiredH = srcW / winAR;
      sy = (srcH - desiredH) / 2;
      sh = desiredH;
    }
    ctx.drawImage(this.inputCanvas!, sx, sy, sw, sh, this.WINDOW_X, this.WINDOW_Y, winW, winH);
    ctx.restore();

    ctx.restore();

    // esconde preview cru quando o efeito está pronto
    if (!this.haveEffect && this.previewVideo) {
      this.haveEffect = true;
      this.previewVideo.style.visibility = 'hidden';
      this.previewVideo.style.display = 'none';
    }
  }

  // --------------------------------------------------------------------------
  // Desenha webcam → inputCanvas (uma transformação bem barata)
  private drawRotatedWebcamIntoInput() {
    const ctx = this.inputCtx!;
    const v = this.camVideo!;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return;

    ctx.save();
    ctx.clearRect(0, 0, this.W, this.H);

    if (this.ROTATE_CLOCKWISE) {
      ctx.translate(this.W / 2, this.H / 2);
      ctx.rotate(90 * Math.PI / 180);
      if (this.MIRROR) ctx.scale(-1, 1);
      ctx.drawImage(v, -this.H / 2, -this.W / 2, this.H, this.W);
    } else {
      ctx.translate(this.W / 2, this.H / 2);
      if (this.MIRROR) ctx.scale(-1, 1);
      ctx.drawImage(v, -this.W / 2, -this.H / 2, this.W, this.H);
    }

    ctx.restore();
  }

  // Helper: contain (inteiro na tela, com barras)
  private drawMediaContain(
    ctx: CanvasRenderingContext2D,
    media: HTMLVideoElement | HTMLImageElement,
    W: number,
    H: number,
    fill: string = '#000'
  ) {
    const mw =
      (media as HTMLVideoElement).videoWidth ||
      (media as HTMLImageElement).naturalWidth;
    const mh =
      (media as HTMLVideoElement).videoHeight ||
      (media as HTMLImageElement).naturalHeight;
    if (!mw || !mh) return;

    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, W, H);

    const scale = Math.min(W / mw, H / mh);
    const dw = mw * scale;
    const dh = mh * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    ctx.drawImage(media, 0, 0, mw, mh, dx, dy, dw, dh);
  }

  // --------------------------------------------------------------------------
  // Recorder
  async startRecording() {
    if (this.recording || !this.compositeCanvas) return;

    try { await this.bgVideo?.play(); } catch {}

    const stream = this.compositeCanvas.captureStream(this.FPS);
    this.chunks = [];

    // H.264 baseline — maior compatibilidade
    const mime =
      MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E') ? 'video/mp4;codecs=avc1.42E01E' :
      MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' :
      'video/webm';

    this.mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    this.mediaRecorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    const done = new Promise<Blob>((resolve) => {
      this.mediaRecorder!.onstop = () => resolve(new Blob(this.chunks, { type: mime.includes('mp4') ? 'video/mp4' : 'video/webm' }));
    });

    this.recording = true;
    this.showChoice = false;
    this.mediaRecorder.start();

    await new Promise(r => setTimeout(r, 10_000));

    this.mediaRecorder.stop();
    this.recordedBlob = await done;

    this.recording = false;
    this.showChoice = true;
  }

  retry() {
    this.showChoice = false;
    this.recordedBlob = undefined;
    this.haveEffect = false;
    if (this.previewVideo) {
      this.previewVideo.style.visibility = 'visible';
      this.previewVideo.style.display = '';
    }
  }

  send() {
    if (!this.recordedBlob) return;
    this.videoService.uploadVideo(this.recordedBlob).subscribe({
      next: ({ url }) => {
        this.dataService.setVideoUrl(url);
        this.router.navigateByUrl('/compartilhar');
      },
      error: () => alert('Falha ao enviar vídeo. Verifique o backend.')
    });
  }

  // --------------------------------------------------------------------------
  // Utils & cleanup
  private async waitForVideo(v: HTMLVideoElement) {
    if (v.readyState >= 2 && v.videoWidth && v.videoHeight) return;
    await new Promise<void>((res) => {
      const check = () => (v.readyState >= 2 && v.videoWidth && v.videoHeight) ? res() : requestAnimationFrame(check);
      check();
    });
  }

  private stopAll() {
    try {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.mediaRecorder?.stop();

      const s = this.camVideo?.srcObject as MediaStream | null;
      s?.getTracks().forEach(t => t.stop());

      this.camVideo = undefined;
      this.previewVideo = undefined;
      this.bgVideo = undefined;
      this.inputCtx = null;
      this.compositeCtx = null;
      this.staticMatte = undefined;
      this.staticOutline = undefined;
    } catch {}
  }
}
