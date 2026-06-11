import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';

import { LotteryDashboardComponent } from './lottery/lottery-dashboard.component';

@Component({
  selector: 'app-root',
  imports: [MatToolbarModule, MatIconModule, LotteryDashboardComponent],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = '中籤率小幫手';
}
