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
          <span class="material-symbols-outlined" [class.text-yellow-500]="theme() === 'secondary'">{{ icon() }}</span>
        }
        {{ title() }}
      </h3>
      <p class="text-slate-600 mb-6 max-w-lg mx-auto flex-grow">{{ description() }}</p>
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
    const base = 'border rounded-xl p-8 text-center flex flex-col';
    if (this.theme() === 'primary') {
      return `${base} bg-[#e0e7ff] border-blue-200`;
    }
    return `${base} bg-white border-slate-200`;
  }

  getTitleClass(): string {
    const base = 'text-xl font-bold mb-2';
     if (this.theme() === 'primary') {
      return `${base} text-[#004a99]`;
    }
    return `${base} text-slate-800 flex items-center justify-center gap-2`;
  }

  getButtonClass(): string {
    const base = 'px-8 py-3 rounded-lg font-medium transition-colors shadow-lg';
    if (this.theme() === 'primary') {
      return `${base} bg-[#004a99] text-white hover:bg-blue-800 shadow-blue-900/20`;
    }
    return `${base} bg-slate-800 text-white hover:bg-slate-900 shadow-slate-900/20`;
  }
}
