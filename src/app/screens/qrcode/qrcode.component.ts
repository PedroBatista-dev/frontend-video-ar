import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { QRCodeComponent } from 'angularx-qrcode';

@Component({
  selector: 'app-qrcode',
  standalone: true,
  imports: [CommonModule, QRCodeComponent],
  templateUrl: './qrcode.component.html',
  styleUrls: ['./qrcode.component.scss']
})
export class QrcodeComponent implements OnInit {
  videoUrl: string | null = null;

  constructor(private router: Router, private dataService: DataService) {}

  ngOnInit(): void {
    this.videoUrl = this.dataService.getVideoUrl();
    if (!this.videoUrl) {
      console.error("URL do vídeo não encontrada. Redirecionando para o início.");
      this.router.navigate(['/inicio']);
    }
  }

  proceed(): void {
    this.router.navigate(['/obrigado']);
  }
}