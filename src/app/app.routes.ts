import { Routes } from '@angular/router';

import { WelcomeComponent } from './screens/welcome/welcome.component';
import { FormComponent } from './screens/form/form.component';
import { WaitComponent } from './screens/wait/wait.component';
import { RecordingComponent } from './screens/recording/recording.component';
import { QrcodeComponent } from './screens/qrcode/qrcode.component';
import { ThanksComponent } from './screens/thanks/thanks.component';

export const routes: Routes = [
  { path: 'inicio', component: WelcomeComponent },
  { path: 'cadastro', component: FormComponent },
  { path: 'aguarde', component: WaitComponent },
  { path: 'gravacao', component: RecordingComponent },
  { path: 'compartilhar', component: QrcodeComponent },
  { path: 'obrigado', component: ThanksComponent },
  { path: '', redirectTo: '/inicio', pathMatch: 'full' },
  { path: '**', redirectTo: '/inicio', pathMatch: 'full' }
];