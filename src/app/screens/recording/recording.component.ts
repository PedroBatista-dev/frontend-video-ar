// recording.component.ts
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
  private previewVideo?: HTMLVideoElement;       // <video> visível (fallback imediato)
  private camVideo?: HTMLVideoElement;           // fonte da webcam (mesmo do preview)
  private bgVideo?: HTMLVideoElement;            // vídeo de fundo

  private inputCanvas?: HTMLCanvasElement;       // webcam rotacionada (e opc. espelhada) p/ retrato
  private inputCtx?: CanvasRenderingContext2D | null;

  private compositeCanvas?: HTMLCanvasElement;   // canvas final (exibido + gravado)
  private compositeCtx?: CanvasRenderingContext2D | null;

  // Offscreens para qualidade do recorte e contorno
  private matteCanvas?: HTMLCanvasElement;       // máscara suavizada (feather)
  private matteCtx?: CanvasRenderingContext2D | null;

  private personCanvas?: HTMLCanvasElement;      // conteúdo recortado (webcam dentro da janela)
  private personCtx?: CanvasRenderingContext2D | null;

  private outlineCanvas?: HTMLCanvasElement;     // traço/contorno ao redor da janela
  private outlineCtx?: CanvasRenderingContext2D | null;

  // Recorder
  private mediaRecorder?: MediaRecorder;
  private chunks: Blob[] = [];

  // Segmentation (usado apenas se USE_FIXED_WINDOW=false)
  private selfieSeg?: any;
  private processing = false;
  private lastMask?: HTMLCanvasElement;
  private haveEffect = false; // quando true, escondo o preview cru

  // --------------------------------------------------------------------------
  // Config (ajuste estes se precisar)
  private readonly W = 1440;
  private readonly H = 1920;
  private readonly ROTATE_CLOCKWISE = true; // câmera em paisagem → girar 90°
  private readonly MIRROR = false;          // efeito “espelho”

  // 🔧 Qualidade do recorte e contorno
  private readonly FEATHER_PX = 2;                        // suaviza a borda (1–4)
  private readonly OUTLINE_WIDTH = 8;                     // espessura do traço (px)
  private readonly OUTLINE_COLOR = 'rgba(255,255,255,0.95)'; // cor do traço
  private readonly OUTLINE_SOFTNESS = 1;                  // leve suavização do traço

  // 🔁 Modo janela fixa para webcam (substitui a pessoa segmentada)
  private readonly USE_FIXED_WINDOW = true;

  // Geometria da janela em arco (em px, no canvas 1440×1920)
  private readonly WINDOW_X = 582;
  private readonly WINDOW_Y = 690;
  private readonly WINDOW_W = 275;
  private readonly WINDOW_H = 810;
  // Raio do arco no topo. Para um arco perfeito (semicírculo), use W/2 (=WINDOW_W/2).
  private readonly WINDOW_ARCH_RADIUS = this.WINDOW_W / 2;

  constructor(
    private router: Router,
    private dataService: DataService,
    private videoService: VideoService
  ) {}

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.createElements();
    await this.startCamera();           // liga webcam e mostra preview
    await this.startBackgroundVideo();  // tenta tocar bg

    // Carrega a segmentação apenas se for usar o modo "Pessoa"
    if (!this.USE_FIXED_WINDOW) {
      await this.initSegmentation();
    }

    this.loop();                        // inicia render
  }

  ngOnDestroy() { this.stopAll(); }

  // --------------------------------------------------------------------------
  // Setup
  private createElements() {
    const container = this.containerRef.nativeElement;

    // Preview <video> (garante imagem instantânea)
    this.previewVideo = document.createElement('video');
    this.previewVideo.className = 'preview-video';
    this.previewVideo.autoplay = true;
    this.previewVideo.playsInline = true;
    this.previewVideo.muted = true;
    container.appendChild(this.previewVideo);

    // Canvas final (exibido e gravado)
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = this.W;
    this.compositeCanvas.height = this.H;
    this.compositeCanvas.className = 'composite-canvas';
    this.compositeCtx = this.compositeCanvas.getContext('2d', { alpha: true });
    container.appendChild(this.compositeCanvas);

    // Canvas de entrada para a segmentação (mesma orientação do preview)
    this.inputCanvas = document.createElement('canvas');
    this.inputCanvas.width = this.W;
    this.inputCanvas.height = this.H;
    this.inputCtx = this.inputCanvas.getContext('2d');

    // Offscreens para matte, conteúdo e contorno
    this.matteCanvas = document.createElement('canvas');
    this.matteCanvas.width = this.W;
    this.matteCanvas.height = this.H;
    this.matteCtx = this.matteCanvas.getContext('2d');

    this.personCanvas = document.createElement('canvas');
    this.personCanvas.width = this.W;
    this.personCanvas.height = this.H;
    this.personCtx = this.personCanvas.getContext('2d');

    this.outlineCanvas = document.createElement('canvas');
    this.outlineCanvas.width = this.W;
    this.outlineCanvas.height = this.H;
    this.outlineCtx = this.outlineCanvas.getContext('2d');

    // Vídeos
    this.camVideo = this.previewVideo;
    this.bgVideo = document.createElement('video');
    this.bgVideo.src = 'assets/videos/background.mp4'; // ajuste se necessário
    this.bgVideo.loop = true;
    this.bgVideo.muted = true;
    this.bgVideo.playsInline = true;
  }

  private async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 3840 },  // pode pedir 4K; a câmera usará o máximo suportado
        height: { ideal: 2160 },
        frameRate: { ideal: 30 }
      },
      audio: false
    });
    this.camVideo!.srcObject = stream;
    try { await this.camVideo!.play(); } catch {}
    await this.waitForVideo(this.camVideo!);

    // Ajusta o <video> preview para ocupar W×H e mesma orientação do canvas
    this.layoutPreviewAsPortrait();
  }

  // Posiciona/rotaciona/espelha o preview para coincidir com o canvas (W×H)
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
    v.style.background = 'transparent';
    v.style.objectFit = 'cover';
    v.style.visibility = 'visible';
  }

  private async startBackgroundVideo() {
    try { await this.bgVideo!.play(); } catch { /* tenta novamente ao gravar */ }
  }

  private async initSegmentation() {
    const mp = await import('@mediapipe/selfie_segmentation');
    const { SelfieSegmentation } = mp as any;

    this.selfieSeg = new SelfieSegmentation({
      locateFile: (file: string) => `assets/mediapipe/selfie_segmentation/${file}`,
    });

    // ✅ Sem selfieMode para evitar flips internos que “descasam” a máscara.
    this.selfieSeg.setOptions({
      modelSelection: 1,   // corpo inteiro
      selfieMode: false    // não inverter automaticamente
    });

    this.selfieSeg.onResults((results: any) => {
      this.lastMask = results.segmentationMask as HTMLCanvasElement;
      this.processing = false;
    });
  }

  // --------------------------------------------------------------------------
  // Loop
  private loop = async () => {
    // 1) desenha webcam (mesma rotação/espelho do preview) no inputCanvas
    this.drawRotatedWebcamIntoInput();

    // 2) compõe
    if (this.USE_FIXED_WINDOW) {
      // 🚪 Janela fixa: não depende da segmentação
      this.renderCompositeWithFixedWindow();
      if (!this.haveEffect) {
        this.haveEffect = true;
        if (this.previewVideo) {
          this.previewVideo.style.visibility = 'hidden';
          this.previewVideo.style.display = 'none'; // garante que não “vaze” por trás
        }
      }
    } else {
      // 👤 Modo segmentação (com pessoa)
      if (this.lastMask) {
        this.renderCompositeWithMask(this.lastMask);
        if (!this.haveEffect) {
          this.haveEffect = true;
          if (this.previewVideo) {
            this.previewVideo.style.visibility = 'hidden';
            this.previewVideo.style.display = 'none';
          }
        }
      } else {
        const ctx = this.compositeCtx!;
        ctx.clearRect(0, 0, this.W, this.H);
      }
    }

    // 3) dispara segmentação somente se NÃO estiver no modo janela fixa
    if (!this.USE_FIXED_WINDOW && !this.processing && this.selfieSeg) {
      this.processing = true;
      await this.selfieSeg.send({ image: this.inputCanvas! });
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  // Desenha a webcam no inputCanvas com a MESMA geometria do preview (rotação + espelho)
  private drawRotatedWebcamIntoInput() {
    const ctx = this.inputCtx!;
    const v = this.camVideo!;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return;

    ctx.save();
    ctx.clearRect(0, 0, this.W, this.H);

    // Transforma coordenadas para desenhar preenchendo W×H
    if (this.ROTATE_CLOCKWISE) {
      ctx.translate(this.W / 2, this.H / 2);
      ctx.rotate(90 * Math.PI / 180);
      if (this.MIRROR) ctx.scale(-1, 1); // espelha se necessário
      ctx.drawImage(v, -this.H / 2, -this.W / 2, this.H, this.W);
    } else {
      ctx.translate(this.W / 2, this.H / 2);
      if (this.MIRROR) ctx.scale(-1, 1);
      ctx.drawImage(v, -this.W / 2, -this.H / 2, this.W, this.H);
    }

    ctx.restore();
  }

  // Helper: desenha mantendo proporção e preenchendo todo o W×H (corta excesso)
  private drawMediaCover(
    ctx: CanvasRenderingContext2D,
    media: HTMLVideoElement | HTMLImageElement,
    W: number,
    H: number
  ) {
    const mw =
      (media as HTMLVideoElement).videoWidth ||
      (media as HTMLImageElement).naturalWidth;
    const mh =
      (media as HTMLVideoElement).videoHeight ||
      (media as HTMLImageElement).naturalHeight;
    if (!mw || !mh) return;

    const targetAR = W / H;
    const mediaAR = mw / mh;

    let sx = 0, sy = 0, sw = mw, sh = mh;
    if (mediaAR > targetAR) {
      const desired = mh * targetAR;
      sx = (mw - desired) / 2;
      sw = desired;
    } else {
      const desired = mw / targetAR;
      sy = (mh - desired) / 2;
      sh = desired;
    }
    ctx.drawImage(media, sx, sy, sw, sh, 0, 0, W, H);
  }

  // NOVO: Encaixa o vídeo COMPLETO no canvas (sem cortes), centralizado, com barras
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

    // limpa e pinta o fundo (barras)
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, W, H);

    // escala para CABER por completo (contain)
    const scale = Math.min(W / mw, H / mh);
    const dw = mw * scale;
    const dh = mh * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    ctx.drawImage(media, 0, 0, mw, mh, dx, dy, dw, dh);
  }

  // --------------------------------------------------------------------------
  // Composição com máscara de pessoa (modo alternativo)
  private renderCompositeWithMask(maskCanvas: HTMLCanvasElement) {
    const W = this.W, H = this.H;

    const matteCtx = this.matteCtx!;
    const personCtx = this.personCtx!;
    const outlineCtx = this.outlineCtx!;
    const outCtx = this.compositeCtx!;

    // --- 1) Matte (máscara suavizada) ---
    matteCtx.save();
    matteCtx.clearRect(0, 0, W, H);
    if (this.FEATHER_PX > 0) {
      (matteCtx as any).filter = `blur(${this.FEATHER_PX}px)`;
      matteCtx.drawImage(maskCanvas, 0, 0, W, H);
      (matteCtx as any).filter = 'none';
    } else {
      matteCtx.drawImage(maskCanvas, 0, 0, W, H);
    }
    matteCtx.restore();

    // --- 2) Recorta a pessoa ---
    personCtx.save();
    personCtx.clearRect(0, 0, W, H);
    personCtx.drawImage(this.inputCanvas!, 0, 0, W, H);
    personCtx.globalCompositeOperation = 'destination-in';
    personCtx.drawImage(this.matteCanvas!, 0, 0, W, H);
    personCtx.globalCompositeOperation = 'source-over';
    personCtx.restore();

    // --- 3) Gera o contorno ---
    outlineCtx.save();
    outlineCtx.clearRect(0, 0, W, H);

    const blurForOutline = Math.max(1, this.OUTLINE_WIDTH);
    (outlineCtx as any).filter = `blur(${blurForOutline}px)`;
    outlineCtx.drawImage(maskCanvas, 0, 0, W, H);
    (outlineCtx as any).filter = 'none';

    outlineCtx.globalCompositeOperation = 'source-in';
    outlineCtx.fillStyle = this.OUTLINE_COLOR;
    outlineCtx.fillRect(0, 0, W, H);

    outlineCtx.globalCompositeOperation = 'destination-out';
    outlineCtx.drawImage(this.matteCanvas!, 0, 0, W, H);

    if (this.OUTLINE_SOFTNESS > 0) {
      const tmp = document.createElement('canvas');
      tmp.width = W; tmp.height = H;
      const tctx = tmp.getContext('2d')!;
      tctx.drawImage(this.outlineCanvas!, 0, 0);
      outlineCtx.globalCompositeOperation = 'copy';
      (outlineCtx as any).filter = `blur(${this.OUTLINE_SOFTNESS}px)`;
      outlineCtx.drawImage(tmp, 0, 0);
      (outlineCtx as any).filter = 'none';
      outlineCtx.globalCompositeOperation = 'source-over';
    }

    outlineCtx.restore();

    // --- 4) Composição final ---
    outCtx.save();
    outCtx.clearRect(0, 0, W, H);

    // Fundo (entra inteiro)
    if (this.bgVideo && this.bgVideo.readyState >= 2) {
      this.drawMediaContain(outCtx, this.bgVideo, W, H);
    } else {
      outCtx.fillStyle = '#000';
      outCtx.fillRect(0, 0, W, H);
    }

    outCtx.drawImage(this.outlineCanvas!, 0, 0, W, H);
    outCtx.drawImage(this.personCanvas!, 0, 0, W, H);

    outCtx.restore();
  }

  // --------------------------------------------------------------------------
  // 🔹 Composição com "janela fixa" em ARCO (fundo + contorno + webcam recortada)
  private renderCompositeWithFixedWindow() {
    const W = this.W, H = this.H;

    const matteCtx = this.matteCtx!;
    const personCtx = this.personCtx!;
    const outlineCtx = this.outlineCtx!;
    const outCtx = this.compositeCtx!;

    // --- 1) Matte (máscara suavizada da janela em ARCO) ---
    matteCtx.save();
    matteCtx.clearRect(0, 0, W, H);

    // desenha a forma base (branca) da janela
    matteCtx.fillStyle = '#fff';
    this.archWindowPath(
      matteCtx, this.WINDOW_X, this.WINDOW_Y, this.WINDOW_W, this.WINDOW_H, this.WINDOW_ARCH_RADIUS
    );
    matteCtx.fill();

    // aplica feather (suaviza bordas)
    if (this.FEATHER_PX > 0) {
      const tmp = document.createElement('canvas');
      tmp.width = W; tmp.height = H;
      const tctx = tmp.getContext('2d')!;
      tctx.drawImage(this.matteCanvas!, 0, 0);
      (matteCtx as any).filter = `blur(${this.FEATHER_PX}px)`;
      matteCtx.clearRect(0, 0, W, H);
      matteCtx.drawImage(tmp, 0, 0);
      (matteCtx as any).filter = 'none';
    }
    matteCtx.restore();

    // --- 2) Webcam SOMENTE dentro da janela (clip) e encaixada por "cover" no retângulo da janela ---
    personCtx.save();
    personCtx.clearRect(0, 0, W, H);

    // recorta a área da janela em arco
    this.archWindowPath(
      personCtx,
      this.WINDOW_X, this.WINDOW_Y, this.WINDOW_W, this.WINDOW_H, this.WINDOW_ARCH_RADIUS
    );
    personCtx.clip();

    // calcular "cover" do inputCanvas para caber na janela (sem distorcer)
    const srcW = this.inputCanvas!.width;   // = W
    const srcH = this.inputCanvas!.height;  // = H
    const winW = this.WINDOW_W;
    const winH = this.WINDOW_H;

    const winAR = winW / winH;
    const srcAR = srcW / srcH;

    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcAR > winAR) {
      // fonte mais "larga" que a janela -> cortar laterais
      const desiredW = srcH * winAR;
      sx = (srcW - desiredW) / 2;
      sw = desiredW;
    } else {
      // fonte mais "alta" -> cortar topo/baixo
      const desiredH = srcW / winAR;
      sy = (srcH - desiredH) / 2;
      sh = desiredH;
    }

    // desenha somente na área da janela (nada do restante do canvas recebe webcam)
    personCtx.drawImage(
      this.inputCanvas!,  // já rotacionada/espelhada
      sx, sy, sw, sh,
      this.WINDOW_X, this.WINDOW_Y, winW, winH
    );

    personCtx.restore();

    // --- 3) Gera o contorno da janela ---
    outlineCtx.save();
    outlineCtx.clearRect(0, 0, W, H);

    // base da janela "sólida" (sem feather) para dilatar
    const base = document.createElement('canvas');
    base.width = W; base.height = H;
    const bctx = base.getContext('2d')!;
    bctx.fillStyle = '#fff';
    this.archWindowPath(bctx, this.WINDOW_X, this.WINDOW_Y, this.WINDOW_W, this.WINDOW_H, this.WINDOW_ARCH_RADIUS);
    bctx.fill();

    // dilata via blur para criar área do traço
    const blurForOutline = Math.max(1, this.OUTLINE_WIDTH);
    (outlineCtx as any).filter = `blur(${blurForOutline}px)`;
    outlineCtx.drawImage(base, 0, 0);
    (outlineCtx as any).filter = 'none';

    // colore área dilatada
    outlineCtx.globalCompositeOperation = 'source-in';
    outlineCtx.fillStyle = this.OUTLINE_COLOR;
    outlineCtx.fillRect(0, 0, W, H);

    // remove o interior usando o matte suavizado (fica só o anel)
    outlineCtx.globalCompositeOperation = 'destination-out';
    outlineCtx.drawImage(this.matteCanvas!, 0, 0, W, H);

    // suavização final do contorno
    if (this.OUTLINE_SOFTNESS > 0) {
      const tmp2 = document.createElement('canvas');
      tmp2.width = W; tmp2.height = H;
      const t2 = tmp2.getContext('2d')!;
      t2.drawImage(this.outlineCanvas!, 0, 0);
      outlineCtx.globalCompositeOperation = 'copy';
      (outlineCtx as any).filter = `blur(${this.OUTLINE_SOFTNESS}px)`;
      outlineCtx.drawImage(tmp2, 0, 0);
      (outlineCtx as any).filter = 'none';
      outlineCtx.globalCompositeOperation = 'source-over';
    }
    outlineCtx.restore();

    // --- 4) Composição final: fundo → contorno → webcam recortada ---
    outCtx.save();
    outCtx.clearRect(0, 0, W, H);

    // Fundo (entra inteiro)
    if (this.bgVideo && this.bgVideo.readyState >= 2) {
      this.drawMediaContain(outCtx, this.bgVideo, W, H);
    } else {
      outCtx.fillStyle = '#000';
      outCtx.fillRect(0, 0, W, H);
    }

    // Contorno da janela
    outCtx.drawImage(this.outlineCanvas!, 0, 0, W, H);

    // Webcam dentro da janela (somente área clipada)
    outCtx.drawImage(this.personCanvas!, 0, 0, W, H);

    outCtx.restore();
  }

  // 🔧 path de JANELA EM ARCO (topo semicircular + laterais e base retas)
  private archWindowPath(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number
  ) {
    // r = raio do arco superior; use r = w/2 para um arco perfeito (meia-lua).
    const radius = Math.max(1, Math.min(r, w / 2));
    const cx = x + w / 2;     // centro do arco
    const cy = y + radius;    // y do centro do arco

    ctx.beginPath();
    // começa na lateral esquerda, logo abaixo do início do arco
    ctx.moveTo(x, y + radius);
    // arco superior da esquerda (π) para a direita (0)
    ctx.arc(cx, cy, radius, Math.PI, 0, false);
    // desce a lateral direita até a base reta
    ctx.lineTo(x + w, y + h);
    // base reta até a lateral esquerda
    ctx.lineTo(x, y + h);
    // sobe pela lateral esquerda até fechar na origem
    ctx.closePath();
  }

  // --------------------------------------------------------------------------
  // Recorder
  async startRecording() {
    if (this.recording || !this.compositeCanvas) return;

    try { await this.bgVideo?.play(); } catch {}

    const stream = this.compositeCanvas.captureStream(30);

    this.chunks = [];
    const mime =
      MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.64003E,mp4a.40.2') ? 'video/mp4;codecs=avc1.64003E,mp4a.40.2' :
      MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.64003E,opus') ? 'video/mp4;codecs=avc1.64003E,opus' :
      'video/mp4';

    this.mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    this.mediaRecorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    const done = new Promise<Blob>((resolve) => {
      this.mediaRecorder!.onstop = () => resolve(new Blob(this.chunks, { type: 'video/mp4' }));
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
    // Reexibe o preview cru ao reiniciar
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

      if (this.selfieSeg?.close) this.selfieSeg.close();

      this.camVideo = undefined;
      this.previewVideo = undefined;
      this.bgVideo = undefined;
      this.inputCtx = null;
      this.compositeCtx = null;
      this.matteCtx = null;
      this.personCtx = null;
      this.outlineCtx = null;
      this.lastMask = undefined;
    } catch {}
  }
}
