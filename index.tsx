
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withJsonpSupport } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppComponent } from './app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withJsonpSupport()),
    provideZonelessChangeDetection()
  ]
}).catch((err) => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.
