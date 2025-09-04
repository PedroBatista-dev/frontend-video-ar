import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ArScriptLoaderService {
  private aframeLoaded = false;
  private mindarLoaded = false;

  load(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.aframeLoaded && this.mindarLoaded) {
        return resolve();
      }

      this.loadScript('aframe', 'https://aframe.io/releases/1.5.0/aframe.min.js')
        .then(() => {
          this.aframeLoaded = true;
          return this.loadScript('mindar', 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js');
        })
        .then(() => {
          this.mindarLoaded = true;
          resolve();
        })
        .catch((error) => reject(error));
    });
  }

  private loadScript(id: string, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.getElementById(id)) {
        return resolve();
      }

      const script = document.createElement('script');
      script.id = id;
      script.src = url;
      script.onload = () => resolve();
      script.onerror = (error) => reject(error);
      document.head.appendChild(script);
    });
  }
}