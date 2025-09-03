import { Injectable } from '@angular/core';

export interface UserData {
  name: string;
  email: string;
  phone: string;
}

@Injectable({ providedIn: 'root' })
export class DataService {
  private userData: UserData | null = null;
  private videoUrl: string = '';

  setUserData(data: UserData) { this.userData = data; }
  getUserData(): UserData | null { return this.userData; }
  setVideoUrl(url: string) { this.videoUrl = url; }
  getVideoUrl(): string { return this.videoUrl; }
  clearData() {
    this.userData = null;
    this.videoUrl = '';
  }
}