import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';

interface NotificationConfig {
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  email_from: string;
  email_to: string;
  telegram_enabled: boolean;
  telegram_token: string;
  telegram_chat_id: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-notifications-config',
  imports: [MatIconModule],
  template: `
    <div class="space-y-6">
      <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div class="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div class="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
            <mat-icon>notifications_active</mat-icon>
          </div>
          <div>
            <h3 class="text-lg font-bold text-white">Centrum Powiadomień i Alertów</h3>
            <p class="text-xs text-slate-400">Skonfiguruj integrację z serwerem pocztowym SMTP oraz botem komunikatora Telegram, aby otrzymywać alarmy bezpośrednio na telefon.</p>
          </div>
        </div>

        @if (statusMessage()) {
          <div
            class="p-4 rounded-xl border text-xs flex items-start gap-3"
            [class]="statusType() === 'success' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/60' : 'bg-rose-950/40 text-rose-400 border-rose-800/60'"
          >
            <mat-icon class="shrink-0">{{ statusType() === 'success' ? 'check_circle' : 'error' }}</mat-icon>
            <span class="font-medium">{{ statusMessage() }}</span>
          </div>
        }

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Sekcja E-mail (SMTP) -->
          <div class="space-y-4 p-5 rounded-xl bg-slate-950 border border-slate-800/60">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2">
                <mat-icon class="text-sky-400">mail</mat-icon>
                <span class="font-bold text-white text-sm">Powiadomienia E-mail (SMTP)</span>
              </div>
              <button
                (click)="emailEnabled.set(!emailEnabled())"
                class="px-3 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer"
                [class.bg-emerald-600]="emailEnabled()"
                [class.text-white]="emailEnabled()"
                [class.border-emerald-500/30]="emailEnabled()"
                [class.bg-slate-800]="!emailEnabled()"
                [class.text-slate-400]="!emailEnabled()"
                [class.border-slate-700]="!emailEnabled()"
              >
                {{ emailEnabled() ? 'WŁĄCZONE' : 'WYŁĄCZONE' }}
              </button>
            </div>

            <div class="space-y-3 text-xs">
              <div class="space-y-1">
                <span class="text-slate-400 block font-medium">Serwer SMTP (Host):</span>
                <input
                  type="text"
                  [value]="smtpHost()"
                  (input)="smtpHost.set($any($event.target).value)"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-sky-500"
                  placeholder="np. smtp.gmail.com"
                />
              </div>

              <div class="grid grid-cols-3 gap-3">
                <div class="col-span-2 space-y-1">
                  <span class="text-slate-400 block font-medium">Port SMTP:</span>
                  <input
                    type="number"
                    [value]="smtpPort()"
                    (input)="smtpPort.set(+$any($event.target).value)"
                    class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-sky-500 font-mono"
                    placeholder="587"
                  />
                </div>
                <div class="col-span-1 flex items-end">
                  <span class="text-[10px] text-slate-500 pb-2 italic">SSL (465) / TLS (587)</span>
                </div>
              </div>

              <div class="space-y-1">
                <span class="text-slate-400 block font-medium">Użytkownik (Login / Email):</span>
                <input
                  type="text"
                  [value]="smtpUser()"
                  (input)="smtpUser.set($any($event.target).value)"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-sky-500 font-mono"
                  placeholder="twoj-email@gmail.com"
                />
              </div>

              <div class="space-y-1">
                <span class="text-slate-400 block font-medium">Hasło SMTP (lub hasło aplikacji):</span>
                <input
                  type="password"
                  [value]="smtpPass()"
                  (input)="smtpPass.set($any($event.target).value)"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-sky-500 font-mono"
                  placeholder="••••••••••••••••"
                />
              </div>

              <div class="space-y-1">
                <span class="text-slate-400 block font-medium">Adres nadawcy (Od kogo):</span>
                <input
                  type="text"
                  [value]="emailFrom()"
                  (input)="emailFrom.set($any($event.target).value)"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-sky-500"
                  placeholder="noreply@simplehome.local"
                />
              </div>

              <div class="space-y-1">
                <span class="text-slate-400 block font-medium">Adres docelowy (Odbiorca alarmów):</span>
                <input
                  type="text"
                  [value]="emailTo()"
                  (input)="emailTo.set($any($event.target).value)"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-sky-500"
                  placeholder="alarmy@dom.pl"
                />
              </div>

              <div class="pt-2">
                <button
                  (click)="testEmail()"
                  [disabled]="isTestingEmail()"
                  class="w-full py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <mat-icon class="text-sm !w-4 !h-4">send</mat-icon>
                  <span>{{ isTestingEmail() ? 'Wysyłanie testu...' : 'Wyślij e-mail testowy' }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Sekcja Telegram -->
          <div class="space-y-4 p-5 rounded-xl bg-slate-950 border border-slate-800/60">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2">
                <mat-icon class="text-sky-500">send_time_extension</mat-icon>
                <span class="font-bold text-white text-sm">Bot komunikatora Telegram</span>
              </div>
              <button
                (click)="telegramEnabled.set(!telegramEnabled())"
                class="px-3 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer"
                [class.bg-emerald-600]="telegramEnabled()"
                [class.text-white]="telegramEnabled()"
                [class.border-emerald-500/30]="telegramEnabled()"
                [class.bg-slate-800]="!telegramEnabled()"
                [class.text-slate-400]="!telegramEnabled()"
                [class.border-slate-700]="!telegramEnabled()"
              >
                {{ telegramEnabled() ? 'WŁĄCZONE' : 'WYŁĄCZONE' }}
              </button>
            </div>

            <div class="space-y-3 text-xs">
              <div class="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-400 space-y-1.5 leading-relaxed">
                <p class="font-bold text-slate-300">Szybka instrukcja dla Telegrama:</p>
                <ol class="list-decimal pl-4 space-y-1">
                  <li>Utwórz bota w aplikacji Telegram pisząc do <span class="text-sky-400 font-mono">&#64;BotFather</span></li>
                  <li>Skopiuj i wklej poniżej otrzymany <span class="text-white font-mono">Bot Token</span></li>
                  <li>Napisz cokolwiek do swojego bota w Telegramie</li>
                  <li>Pobierz swój <span class="text-white font-mono">Chat ID</span> za pomocą bota <span class="text-sky-400 font-mono">&#64;userinfobot</span> i wklej go poniżej</li>
                </ol>
              </div>

              <div class="space-y-1">
                <span class="text-slate-400 block font-medium">Token Bota (Telegram Bot Token):</span>
                <input
                  type="password"
                  [value]="telegramToken()"
                  (input)="telegramToken.set($any($event.target).value)"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-sky-500 font-mono"
                  placeholder="np. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                />
              </div>

              <div class="space-y-1">
                <span class="text-slate-400 block font-medium">Identyfikator czatu (Chat ID / User ID):</span>
                <input
                  type="text"
                  [value]="telegramChatId()"
                  (input)="telegramChatId.set($any($event.target).value)"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-sky-500 font-mono"
                  placeholder="np. 987654321"
                />
              </div>

              <div class="pt-8">
                <button
                  (click)="testTelegram()"
                  [disabled]="isTestingTelegram()"
                  class="w-full py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <mat-icon class="text-sm !w-4 !h-4">send</mat-icon>
                  <span>{{ isTestingTelegram() ? 'Wysyłanie testu...' : 'Wyślij wiadomość testową' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="pt-4 border-t border-slate-800 flex justify-end gap-3">
          <button
            (click)="saveConfig()"
            [disabled]="isSaving()"
            class="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            <mat-icon class="text-sm !w-4 !h-4">save</mat-icon>
            <span>{{ isSaving() ? 'Zapisywanie...' : 'Zapisz konfigurację' }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
})
export class NotificationsConfig implements OnInit {
  private http = inject(HttpClient);

  readonly emailEnabled = signal<boolean>(false);
  readonly smtpHost = signal<string>('');
  readonly smtpPort = signal<number>(587);
  readonly smtpUser = signal<string>('');
  readonly smtpPass = signal<string>('');
  readonly emailFrom = signal<string>('');
  readonly emailTo = signal<string>('');

  readonly telegramEnabled = signal<boolean>(false);
  readonly telegramToken = signal<string>('');
  readonly telegramChatId = signal<string>('');

  readonly isSaving = signal<boolean>(false);
  readonly isTestingEmail = signal<boolean>(false);
  readonly isTestingTelegram = signal<boolean>(false);

  readonly statusMessage = signal<string | null>(null);
  readonly statusType = signal<'success' | 'error'>('success');

  ngOnInit(): void {
    this.http.get<{ config: NotificationConfig }>('/api/notifications/config').subscribe({
      next: (res) => {
        if (res?.config) {
          const c = res.config;
          this.emailEnabled.set(c.email_enabled);
          this.smtpHost.set(c.smtp_host || '');
          this.smtpPort.set(c.smtp_port || 587);
          this.smtpUser.set(c.smtp_user || '');
          this.smtpPass.set(c.smtp_pass || '');
          this.emailFrom.set(c.email_from || '');
          this.emailTo.set(c.email_to || '');
          this.telegramEnabled.set(c.telegram_enabled);
          this.telegramToken.set(c.telegram_token || '');
          this.telegramChatId.set(c.telegram_chat_id || '');
        }
      },
      error: () => {
        this.statusMessage.set('Błąd podczas ładowania konfiguracji powiadomień.');
        this.statusType.set('error');
      },
    });
  }

  saveConfig(): void {
    this.isSaving.set(true);
    this.statusMessage.set(null);
    const payload = {
      email_enabled: this.emailEnabled(),
      smtp_host: this.smtpHost(),
      smtp_port: this.smtpPort(),
      smtp_user: this.smtpUser(),
      smtp_pass: this.smtpPass(),
      email_from: this.emailFrom(),
      email_to: this.emailTo(),
      telegram_enabled: this.telegramEnabled(),
      telegram_token: this.telegramToken(),
      telegram_chat_id: this.telegramChatId(),
    };

    this.http.post('/api/notifications/config', payload).subscribe({
      next: () => {
        this.statusMessage.set('Konfiguracja powiadomień została pomyślnie zapisana.');
        this.statusType.set('success');
        this.isSaving.set(false);
      },
      error: () => {
        this.statusMessage.set('Wystąpił błąd podczas zapisywania konfiguracji.');
        this.statusType.set('error');
        this.isSaving.set(false);
      },
    });
  }

  testEmail(): void {
    this.isTestingEmail.set(true);
    this.statusMessage.set(null);
    const payload = {
      smtp_host: this.smtpHost(),
      smtp_port: this.smtpPort(),
      smtp_user: this.smtpUser(),
      smtp_pass: this.smtpPass(),
      email_from: this.emailFrom(),
      email_to: this.emailTo(),
    };

    this.http.post<{ success: boolean; message: string }>('/api/notifications/test-email', payload).subscribe({
      next: (res) => {
        this.statusMessage.set(res.message || 'Wiadomość testowa SMTP została wysłana!');
        this.statusType.set(res.success ? 'success' : 'error');
        this.isTestingEmail.set(false);
      },
      error: (err) => {
        this.statusMessage.set(err.error?.message || 'Błąd wysyłki SMTP.');
        this.statusType.set('error');
        this.isTestingEmail.set(false);
      },
    });
  }

  testTelegram(): void {
    this.isTestingTelegram.set(true);
    this.statusMessage.set(null);
    const payload = {
      telegram_token: this.telegramToken(),
      telegram_chat_id: this.telegramChatId(),
    };

    this.http.post<{ success: boolean; message: string }>('/api/notifications/test-telegram', payload).subscribe({
      next: (res) => {
        this.statusMessage.set(res.message || 'Wiadomość testowa Telegram została wysłana!');
        this.statusType.set(res.success ? 'success' : 'error');
        this.isTestingTelegram.set(false);
      },
      error: (err) => {
        this.statusMessage.set(err.error?.message || 'Błąd wysyłki Telegram.');
        this.statusType.set('error');
        this.isTestingTelegram.set(false);
      },
    });
  }
}
