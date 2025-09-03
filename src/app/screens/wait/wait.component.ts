import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-wait',
  standalone: true,
  imports: [],
  templateUrl: './wait.component.html',
  styleUrls: ['./wait.component.scss']
})
export class WaitComponent implements OnInit, OnDestroy {
  private timer: any;
  constructor(private router: Router) {}
  ngOnInit(): void { this.timer = setTimeout(() => this.router.navigate(['/gravacao']), 10000); }
  ngOnDestroy(): void { clearTimeout(this.timer); }
}
