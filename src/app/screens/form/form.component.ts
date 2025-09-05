import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService, UserData } from '../../services/data.service';
import { ParticipantService } from '../../services/participant.service';
import { NgxMaskDirective } from 'ngx-mask';

// ⬇️ importe o componente do teclado (use o caminho onde você salvou)
import { VirtualKeyboardComponent } from '../../shared/virtual-keyboard/virtual-keyboard.component';

@Component({
  selector: 'app-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NgxMaskDirective, VirtualKeyboardComponent],
  templateUrl: './form.component.html',
  styleUrls: ['./form.component.scss']
})
export class FormComponent implements OnInit {
  dataForm!: FormGroup;

  // controla qual campo está com o teclado aberto
  showKeyboardFor: 'name' | 'email' | 'phone' | null = null;

  constructor(
    private router: Router,
    private dataService: DataService,
    private participantService: ParticipantService,
    private fb: FormBuilder
  ) {}

  ngOnInit(): void {
    this.dataForm = this.fb.group({
      // Valida nome e pelo menos um sobrenome
      name: ['', [Validators.required, Validators.pattern(/^[a-zA-ZÀ-ÿ]+\s+[a-zA-ZÀ-ÿ].*$/)]],
      // Valida o formato do e-mail
      email: ['', [Validators.required, Validators.email]],
      // Valida o formato do telefone (com máscara)
      phone: ['', [Validators.required, Validators.minLength(10)]],
      // Checkbox
      shareInfo: ['Não']
    });
  }

  onShareInfoChange(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.dataForm.patchValue({ shareInfo: checked ? 'Sim' : 'Não' });
  }

  onSubmit(): void {
    if (this.dataForm.valid && this.dataForm.get('shareInfo')!.value == 'Sim') {
      const userData: UserData = this.dataForm.value;
      this.dataService.setUserData(userData);
      this.participantService.saveParticipant(userData).subscribe({
        next: () => this.router.navigate(['/aguarde']),
        error: (err) => console.error('Falha ao salvar participante', err)
      });
    } else {
      this.dataForm.markAllAsTouched();
    }
  }

  // Helpers
  get name()  { return this.dataForm.get('name'); }
  get email() { return this.dataForm.get('email'); }
  get phone() { return this.dataForm.get('phone'); }
  get shareInfo() { return this.dataForm.get('shareInfo'); }

  // Abrir/fechar teclado
  openKeyboard(field: 'name' | 'email' | 'phone') {
    this.showKeyboardFor = field;
  }
  closeKeyboard() {
    this.showKeyboardFor = null;
  }
}
