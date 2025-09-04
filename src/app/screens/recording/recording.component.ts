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

  // Recorder
  private mediaRecorder?: MediaRecorder;
  private chunks: Blob[] = [];

  // Segmentation
  private selfieSeg?: any;
  private processing = false;
  private lastMask?: HTMLCanvasElement;
  private haveEffect = false; // quando true, escondo o preview cru

  // Config (ajuste estes dois se precisar)
  private readonly W = 1080;
  private readonly H = 1920;
  private readonly ROTATE_CLOCKWISE = true; // câmera em paisagem → girar 90°
  private readonly MIRROR = false;          // deixe true se quiser tudo “espelhado”

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
    await this.initSegmentation();      // carrega MediaPipe
    this.loop();                        // inicia render/seg
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
    // alpha true para o preview aparecer por baixo até o efeito ficar pronto
    this.compositeCtx = this.compositeCanvas.getContext('2d', { alpha: true });
    container.appendChild(this.compositeCanvas);

    // Canvas de entrada para a segmentação (mesma orientação do preview)
    this.inputCanvas = document.createElement('canvas');
    this.inputCanvas.width = this.W;
    this.inputCanvas.height = this.H;
    this.inputCtx = this.inputCanvas.getContext('2d');

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
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: false
    });
    this.camVideo!.srcObject = stream;
    try { await this.camVideo!.play(); } catch {}
    await this.waitForVideo(this.camVideo!);

    // Ajusta o <video> preview para ocupar 1080×1920 e mesma orientação do canvas
    this.layoutPreviewAsPortrait();
  }

  // Posiciona/rotaciona/espelha o preview para coincidir com o canvas (1080×1920)
  private layoutPreviewAsPortrait() {
    const v = this.previewVideo!;
    v.style.position = 'absolute';
    v.style.zIndex = '0';
    v.style.left = '50%';
    v.style.top = '50%';

    // Base: a câmera entrega 1920×1080 (paisagem). Vamos girar para retrato:
    let rotateDeg = this.ROTATE_CLOCKWISE ? 90 : 0;

    // Espelho opcional (para “efeito selfie”): aplicamos no preview também
    const mirrorScale = this.MIRROR ? ' scaleX(-1)' : '';

    if (this.ROTATE_CLOCKWISE) {
      v.style.width = `${this.H}px`;   // 1920
      v.style.height = `${this.W}px`;  // 1080
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
      selfieMode: false    // <— importante para não inverter automaticamente
    });

    this.selfieSeg.onResults((results: any) => {
      this.lastMask = results.segmentationMask as HTMLCanvasElement;
      this.processing = false;
      // composição é feita no loop
    });
  }

  // --------------------------------------------------------------------------
  // Loop
  private loop = async () => {
    // 1) desenha webcam (mesma rotação/espelho do preview) no inputCanvas
    this.drawRotatedWebcamIntoInput();

    // 2) compõe
    if (this.lastMask) {
      this.renderCompositeWithMask(this.lastMask);
      if (!this.haveEffect) {
        this.haveEffect = true;
        if (this.previewVideo) this.previewVideo.style.visibility = 'hidden'; // esconde preview cru
      }
    } else {
      // sem máscara ainda: mantém o canvas transparente para ver o preview por baixo
      const ctx = this.compositeCtx!;
      ctx.clearRect(0, 0, this.W, this.H);
    }

    // 3) dispara segmentação se livre
    if (!this.processing && this.selfieSeg) {
      this.processing = true;
      // Enviamos ao modelo exatamente a mesma imagem que aparece no canvas final (pessoa)
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

    // Transforma coordenadas para desenhar preenchendo 1080×1920
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

  private renderCompositeWithMask(maskCanvas: HTMLCanvasElement) {
    const ctx = this.compositeCtx!;
    const W = this.W, H = this.H;

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    // 💡 A máscara foi produzida a partir do inputCanvas, que já tem a mesma
    // rotação/espelho do preview. Portanto, basta desenhar “como está”.

    // 1) máscara
    ctx.drawImage(maskCanvas, 0, 0, W, H);

    // 2) vídeo de fundo nas áreas de fundo
    ctx.globalCompositeOperation = 'source-out';
    if (this.bgVideo && this.bgVideo.readyState >= 2) {
      ctx.drawImage(this.bgVideo, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }

    // 3) pessoa (inputCanvas) nas áreas da máscara
    ctx.globalCompositeOperation = 'destination-atop';
    ctx.drawImage(this.inputCanvas!, 0, 0, W, H);

    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // Recorder
  async startRecording() {
    if (this.recording || !this.compositeCanvas) return;

    try { await this.bgVideo?.play(); } catch {}

    const stream = this.compositeCanvas.captureStream(30);

    this.chunks = [];
    const mime =
      MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' :
      MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' :
      'video/webm';

    this.mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    this.mediaRecorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    const done = new Promise<Blob>((resolve) => {
      this.mediaRecorder!.onstop = () => resolve(new Blob(this.chunks, { type: 'video/webm' }));
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
    if (this.previewVideo) this.previewVideo.style.visibility = 'visible';
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
      this.lastMask = undefined;
    } catch {}
  }
}
