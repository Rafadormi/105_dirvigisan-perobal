import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-action-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class]="getContainerClass()">
      <h3 [class]="getTitleClass()">
        @if(icon()) {
          <span class="material-symbols-outlined text-xl">{{ icon() }}</span>
        }
        {{ title() }}
      </h3>
      <p class="text-slate-400 mb-6 max-w-lg mx-auto flex-grow">{{ description() }}</p>
      <button (click)="action.emit()" [class]="getButtonClass()">
        {{ buttonText() }}
      </button>
    </div>
  `,
})
export class ActionCardComponent {
  title = input.required<string>();
  description = input.required<string>();
  buttonText = input.required<string>();
  icon = input<string | undefined>();
  theme = input<'primary' | 'secondary'>('primary');
  action = output<void>();

  getContainerClass(): string {
    const base = 'border rounded-xl p-8 text-center flex flex-col transition-all';
    if (this.theme() === 'primary') {
      return `${base} bg-slate-800 border-slate-700 hover:border-blue-500/50`;
    }
    return `${base} bg-slate-800 border-slate-700 hover:border-slate-600`;
  }

  getTitleClass(): string {
    const base = 'text-xl font-bold mb-2 flex items-center justify-center gap-2';
     if (this.theme() === 'primary') {
      return `${base} text-blue-400`;
    }
    return `${base} text-slate-200`;
  }

  getButtonClass(): string {
    const base = 'px-8 py-3 rounded-lg font-bold transition-transform transform hover:scale-105 shadow-lg';
    if (this.theme() === 'primary') {
      return `${base} bg-blue-600 text-white hover:bg-blue-500 shadow-blue-900/40`;
    }
    return `${base} bg-slate-700 text-slate-200 hover:bg-slate-600 shadow-slate-900/40`;
  }
}