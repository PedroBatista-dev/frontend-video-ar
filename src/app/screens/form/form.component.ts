import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService, UserData } from '../../services/data.service';
import { ParticipantService } from '../../services/participant.service';

@Component({
  selector: 'app-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './form.component.html',
  styleUrls: ['./form.component.scss']
})
export class FormComponent {
  user: UserData = { name: '', email: '', phone: '' };

  constructor(
    private router: Router,
    private dataService: DataService,
    private participantService: ParticipantService
  ) {}

  onSubmit(): void {
    if (this.user.name && this.user.email && this.user.phone) {
      this.dataService.setUserData(this.user);
      this.participantService.saveParticipant(this.user).subscribe({
          next: () => this.router.navigate(['/aguarde']),
          error: (err) => console.error('Falha ao salvar participante', err)
      });
    }
  }
}