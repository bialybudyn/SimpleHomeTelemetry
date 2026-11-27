import { ChangeDetectionStrategy, Component, PLATFORM_ID, inject, input, output, signal, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

const STORAGE_KEY = 'collapsibleSections';

function readState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * Panel z nagłówkiem, który można zwinąć. Stan (zwinięty/rozwinięty) jest zapamiętywany
 * w przeglądarce dla każdego `sectionId`. Zawartość przy zwinięciu jest ukrywana, a nie usuwana
 * (wykresy i mapy nie muszą się tworzyć od nowa).
 *
 * Elementy oznaczone atrybutem `section-actions` trafiają do nagłówka (np. przyciski).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-collapsible-section',
  imports: [MatIconModule],
  template: `
    <section class="rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
      <div class="flex items-center gap-3 p-4 md:px-5">
        <button type="button" (click)="toggle()" [attr.aria-expanded]="open()"
          class="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer group">
          @if (icon()) {
            <span class="w-9 h-9 shrink-0 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <mat-icon class="text-lg !w-5 !h-5" [class]="iconClass()">{{ icon() }}</mat-icon>
            </span>
          }
          <span class="min-w-0">
            <span class="block text-sm md:text-base font-bold text-white tracking-tight truncate">{{ title() }}</span>
            @if (subtitle()) {
              <span class="block text-[11px] text-slate-400 truncate">{{ subtitle() }}</span>
            }
          </span>
          <mat-icon class="ml-auto shrink-0 text-slate-400 group-hover:text-white transition-transform" [class.rotate-180]="open()">expand_more</mat-icon>
        </button>
        <div class="shrink-0 flex items-center gap-2" (click)="$event.stopPropagation()">
          <ng-content select="[section-actions]" />
        </div>
      </div>
      <div [class.hidden]="!open()" class="px-4 pb-4 md:px-5 md:pb-5">
        <ng-content />
      </div>
    </section>
  `,
})
export class CollapsibleSection {
  readonly sectionId = input.required<string>();
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly icon = input<string>('');
  readonly iconClass = input<string>('text-sky-400');
  /** Stan domyślny, gdy użytkownik jeszcze nie zwijał tego panelu. */
  readonly startOpen = input<boolean>(true);
  readonly toggled = output<boolean>();

  readonly open = signal(true);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    effect(() => {
      const id = this.sectionId();
      const def = this.startOpen();
      const saved = this.browser ? readState()[id] : undefined;
      this.open.set(saved ?? def);
    });
  }

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (this.browser) {
      try {
        const state = readState();
        state[this.sectionId()] = next;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // tryb prywatny — stan tylko do przeładowania
      }
    }
    this.toggled.emit(next);
  }
}
