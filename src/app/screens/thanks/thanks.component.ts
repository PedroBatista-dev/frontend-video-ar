import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-thanks',
  standalone: true,
  imports: [],
  templateUrl: './thanks.component.html',
  styleUrls: ['./thanks.component.scss']
})
export class ThanksComponent implements OnInit, OnDestroy {
  private timer: any;
  constructor(private router: Router) {}
  ngOnInit(): void { this.timer = setTimeout(() => this.router.navigate(['/inicio']), 10000); }
  ngOnDestroy(): void { clearTimeout(this.timer); }
}
