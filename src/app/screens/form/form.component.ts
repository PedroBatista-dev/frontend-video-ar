import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService, UserData } from '../../services/data.service';
import { ParticipantService } from '../../services/participant.service';
import { NgxMaskDirective } from 'ngx-mask';

@Component({
  selector: 'app-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NgxMaskDirective],
  templateUrl: './form.component.html',
  styleUrls: ['./form.component.scss']
})
export class FormComponent implements OnInit {
  dataForm!: FormGroup;

  constructor(
    private router: Router,
    private dataService: DataService,
    private participantService: ParticipantService,
    private fb: FormBuilder
  ) {}

  ngOnInit(): void {
    this.dataForm = this.fb.group({
      // Valida nome e pelo menos um sobrenome
      name: ['', [Validators.required, Validators.pattern(/^[a-zA-Z]+\s[a-zA-Z]+.*$/)]],
      // Valida o formato do e-mail
      email: ['', [Validators.required, Validators.email]],
      // Valida o formato do telefone (com máscara)
      phone: ['', [Validators.required, Validators.minLength(10)]],
      // Novo campo checkbox
      shareInfo: ['Não']  // valor inicial "Não"
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
      // Marca todos os campos como "tocados" para exibir as mensagens de erro
      this.dataForm.markAllAsTouched();
    }
  }

  // Métodos de atalho para acessar os controles do formulário no template
  get name() {
    return this.dataForm.get('name');
  }

  get email() {
    return this.dataForm.get('email');
  }

  get phone() {
    return this.dataForm.get('phone');
  }

  get shareInfo() {
    return this.dataForm.get('shareInfo');
  }
}