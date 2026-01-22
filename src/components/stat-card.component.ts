import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bg-slate-800 border border-slate-700 rounded-xl p-6 flex items-center gap-4 hover:border-slate-600 transition-colors">
      <div [class]="'p-3 rounded-lg ' + colorClass()">
        <span class="material-symbols-outlined text-3xl">{{ icon() }}</span>
      </div>
      <div>
        <p class="text-3xl font-bold text-slate-100">{{ value() }}</p>
        <p class="text-sm text-slate-400">{{ label() }}</p>
      </div>
    </div>
  `,
})
export class StatCardComponent {
  icon = input.required<string>();
  value = input.required<string | number>();
  label = input.required<string>();
  colorClass = input.required<string>(); // e.g., 'bg-blue-100 text-[#004a99]'
}