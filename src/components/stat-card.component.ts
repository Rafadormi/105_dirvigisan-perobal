import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-4">
      <div [class]="'p-3 rounded-full ' + colorClass()">
        <span class="material-symbols-outlined">{{ icon() }}</span>
      </div>
      <div>
        <p class="text-3xl font-bold text-slate-800">{{ value() }}</p>
        <p class="text-sm text-slate-500">{{ label() }}</p>
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
