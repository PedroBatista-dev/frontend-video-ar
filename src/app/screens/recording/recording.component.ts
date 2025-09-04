import { Component, ElementRef, ViewChild, OnDestroy, OnInit, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { VideoService } from '../../services/video.service';

type RecordingState = 'idle' | 'recording' | 'preview' | 'uploading' | 'error';

@Component({
  selector: 'app-recording',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recording.component.html',
  styleUrls: ['./recording.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class RecordingComponent implements OnInit, OnDestroy {
  @ViewChild('scene', { static: true }) sceneEl!: ElementRef<any>;

  state: RecordingState = 'idle';
  mediaRecorder: MediaRecorder | null = null;
  recordedChunks: Blob[] = [];
  videoPreviewUrl: string | null = null;

  constructor(
    private router: Router,
    private dataService: DataService,
    private videoService: VideoService
  ) {}

  ngOnInit(): void {}

  startRecording(): void {
    const sceneElement = this.sceneEl.nativeElement as any;
    const canvas: HTMLCanvasElement | null =
      sceneElement.renderer?.domElement || sceneElement.sceneEl?.canvas || null;
    if (!canvas) {
      this.state = 'error';
      return;
    }
    const stream = canvas.captureStream(30);
    this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    this.recordedChunks = [];
    this.state = 'recording';

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.recordedChunks.push(event.data);
    };
    this.mediaRecorder.onstop = () => {
      const videoBlob = new Blob(this.recordedChunks, { type: 'video/webm' });
      this.videoPreviewUrl = URL.createObjectURL(videoBlob);
      this.state = 'preview';
    };
    this.mediaRecorder.start();
    setTimeout(() => { if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop(); }, 10000);
  }

  recordAgain(): void {
    this.state = 'idle';
    this.videoPreviewUrl = null;
    this.recordedChunks = [];
  }

  proceed(): void {
    this.state = 'uploading';
    const videoBlob = new Blob(this.recordedChunks, { type: 'video/webm' });

    this.videoService.uploadVideo(videoBlob).subscribe({
      next: (response) => {
        this.dataService.setVideoUrl(response.url);
        this.router.navigate(['/compartilhar']);
      },
      error: (err) => {
        console.error('Falha no upload:', err);
        this.state = 'error';
      }
    });
  }

  ngOnDestroy(): void {
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
    if (this.videoPreviewUrl) URL.revokeObjectURL(this.videoPreviewUrl);
  }
}