import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VideoService {
  private readonly backendUrl = 'http://localhost:3000/upload';

  constructor(private http: HttpClient) { }

  uploadVideo(videoBlob: Blob): Observable<{ url: string }> {
    const formData = new FormData();
    const videoFile = new File([videoBlob], `video-${Date.now()}.mp4`, { type: 'video/mp4' });
    formData.append('video', videoFile);
    return this.http.post<{ url: string }>(this.backendUrl, formData);
  }
}