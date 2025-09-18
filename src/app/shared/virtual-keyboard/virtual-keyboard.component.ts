import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import Keyboard from 'simple-keyboard';
import { AbstractControl } from '@angular/forms';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-virtual-keyboard',
  standalone: true,
  template: `
    <div class="vk-wrapper" [class.compact]="compact">
      <div #keyboardHost class="simple-keyboard"></div>

      <div class="vk-actions">
        <button type="button" class="vk-btn" (click)="toggleLayout()">⇧ Shift</button>
        <button type="button" class="vk-btn" (click)="setLayout('default')">ABC</button>
        <button type="button" class="vk-btn" (click)="setLayout('numeric')">123</button>
        <button type="button" class="vk-btn danger" (click)="close.emit()">Fechar</button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .vk-wrapper {
      width: 100%;
      max-width: 680px;
      background: #111;
      border-radius: 16px;
      padding: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
    }
    .vk-wrapper.compact { max-width: 420px; }
    .vk-actions {
      display: flex;
      gap: 8px;
      justify-content: space-between;
      margin-top: 8px;
    }
    .vk-btn {
      padding: 8px 12px;
      border-radius: 12px;
      border: 0;
      cursor: pointer;
      background: #1f2937;
      color: #fff;
    }
    .vk-btn:hover { filter: brightness(1.1); }
    .vk-btn.danger { background: #7f1d1d; }
  `]
})
export class VirtualKeyboardComponent implements OnInit, OnDestroy {
  /**
   * Controle do formulário a ser manipulado pelo teclado.
   * Pode ser um FormControl vindo do form (ex: this.dataForm.get('name')).
   */
  @Input({ required: true }) control!: AbstractControl<string | null>;

  /** Reduz a largura do teclado */
  @Input() compact = false;

  /** Fecha o teclado ao pressionar Enter */
  @Input() autoCloseOnEnter = false;

  /** Layout inicial: 'default' ou 'numeric' */
  @Input() initialLayout: 'default' | 'numeric' = 'default';

  /** Emitido quando o botão "Fechar" é clicado ou Enter (se autoCloseOnEnter=true) */
  @Output() close = new EventEmitter<void>();

  @ViewChild('keyboardHost', { static: true }) keyboardHost!: ElementRef<HTMLDivElement>;

  private kb?: Keyboard;
  private currentLayoutName: 'default' | 'shift' | 'numeric' = 'default';
  private sub?: Subscription;

  ngOnInit(): void {
    // Instancia o teclado
    this.kb = new Keyboard(this.keyboardHost.nativeElement, {
      layoutName: 'default',
      mergeDisplay: true,
      display: {
        '{bksp}': '⌫',
        '{enter}': 'Enter',
        '{shift}': '⇧',
        '{space}': 'Espaço',
        '{lock}': 'Caps'
      },
      layout: this.layouts.default,
      onChange: (input: string) => {
        if (!this.control) return;
        this.control.setValue(input as any);
        this.control.markAsDirty();
        this.control.markAsTouched();
      },
      onKeyPress: (button: string) => this.onKeyPress(button)
    });

    // Valor inicial do controle → teclado
    const initial = (this.control?.value ?? '') as string;
    this.kb.setInput(initial);

    // Se quiser começar em numérico
    if (this.initialLayout === 'numeric') {
      this.setLayout('numeric');
    }

    // Se o valor do controle mudar por fora, espelha no teclado
    this.sub = this.control?.valueChanges?.subscribe(v => {
      if (this.kb && v !== this.kb.getInput()) {
        this.kb.setInput((v ?? '') as string);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.kb?.destroy();
  }

  onKeyPress(button: string) {
    if (button === '{shift}' || button === '{lock}') {
      this.toggleLayout();
      return;
    }
    if (button === '{enter}' && this.autoCloseOnEnter) {
      this.close.emit();
    }
  }

  toggleLayout() {
    if (this.currentLayoutName === 'numeric') {
      this.setLayout('default');
      return;
    }
    const next = this.currentLayoutName === 'default' ? 'shift' : 'default';
    this.setLayout(next);
  }

  setLayout(name: 'default' | 'shift' | 'numeric') {
    this.currentLayoutName = name;
    if (name === 'numeric') {
      this.kb?.setOptions({
        layoutName: 'default',
        layout: this.layouts.numeric
      });
      return;
    }
    this.kb?.setOptions({
      layoutName: name === 'shift' ? 'shift' : 'default',
      layout: this.layouts.default
    });
  }

  private layouts = {
    // Layout básico PT-BR (ABNT simplificado)
    default: {
      default: [
        '1 2 3 4 5 6 7 8 9 0 {bksp}',
        'q w e r t y u i o p',
        'a s d f g h j k l ç',
        '{shift} z x c v b n m , . -',
        '{space} {enter}'
      ],
      shift: [
        '! @ # $ % ¨ & * ( ) {bksp}',
        'Q W E R T Y U I O P',
        'A S D F G H J K L Ç',
        '{shift} Z X C V B N M ; : _',
        '{space} {enter}'
      ]
    },
    numeric: {
      default: [
        '1 2 3',
        '4 5 6',
        '7 8 9',
        '0 , . {bksp}',
        '{enter}'
      ]
    }
  };
}
