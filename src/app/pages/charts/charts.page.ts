import { Component, computed, inject, signal } from '@angular/core';
import {
  AlertController,
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToggle,
  IonToolbar,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkCircle,
  closeCircle,
  cloudDoneOutline,
  cloudOfflineOutline,
  cloudUploadOutline,
  downloadOutline,
  logOutOutline,
  refreshOutline,
  trashOutline,
} from 'ionicons/icons';

import { BackupService } from '../../services/backup.service';
import { CopyService } from '../../services/copy.service';
import { GoogleAuthService } from '../../services/google-auth.service';
import { InstallService } from '../../services/install.service';
import { LibraryService } from '../../services/library.service';
import { OfflineService } from '../../services/offline.service';
import { PlayerService } from '../../services/player.service';
import {
  BOOST_OPTIONS,
  CACHE_BUDGETS,
  SKIP_OPTIONS,
  SLEEP_OPTIONS,
  SPEED_OPTIONS,
  SKINS,
  SettingsService,
  Skin,
  ThemeMode,
} from '../../services/settings.service';
import { SyncService } from '../../services/sync.service';
import { bytes, relativeTime } from '../../util/format';

@Component({
  selector: 'app-charts',
  standalone: true,
  templateUrl: './charts.page.html',
  styleUrls: ['./charts.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonToggle,
    IonSelect,
    IonSelectOption,
    IonButton,
    IonIcon,
    IonSegment,
    IonSegmentButton,
  ],
})
export class ChartsPage {
  readonly settings = inject(SettingsService);
  readonly auth = inject(GoogleAuthService);
  readonly sync = inject(SyncService);
  readonly offline = inject(OfflineService);
  readonly library = inject(LibraryService);
  readonly t = inject(CopyService).t;
  readonly install = inject(InstallService);
  private player = inject(PlayerService);
  private backup = inject(BackupService);
  private alerts = inject(AlertController);
  private toasts = inject(ToastController);

  readonly skins = SKINS;
  readonly skipChoices = SKIP_OPTIONS;
  readonly speedChoices = SPEED_OPTIONS;
  readonly boostChoices = BOOST_OPTIONS;
  readonly sleepChoices = SLEEP_OPTIONS;
  readonly budgetChoices = CACHE_BUDGETS;

  readonly storageUsed = signal<string>('');
  readonly persistent = signal<boolean | null>(null);
  readonly showDiagnostics = signal(false);
  readonly diagnostics = signal<{ label: string; ok: boolean; detail: string }[]>([]);

  readonly stowedCount = computed(() => this.offline.cachedIds().size);
  readonly keptCount = computed(() => this.offline.keptCount());
  readonly cacheSize = computed(() => bytes(this.offline.cacheBytes()) || '0 B');

  readonly syncLabel = computed(() => {
    if (!this.auth.isSignedIn()) return 'Sign in to sync';
    if (!this.settings.syncToDrive()) return 'Off';
    switch (this.sync.state()) {
      case 'pulling':
        return 'Reading from Drive…';
      case 'pushing':
        return 'Writing to Drive…';
      case 'error':
        return this.sync.lastError() ?? 'Sync trouble';
      default: {
        const at = this.sync.lastSyncedAt();
        return at ? `Synced ${relativeTime(at)}` : 'Not synced yet';
      }
    }
  });

  constructor() {
    addIcons({
      checkmarkCircle,
      closeCircle,
      logOutOutline,
      cloudDoneOutline,
      cloudOfflineOutline,
      cloudUploadOutline,
      downloadOutline,
      trashOutline,
      refreshOutline,
    });
    void this.readStorage();
  }

  private async readStorage(): Promise<void> {
    const u = await this.offline.usage();
    if (u) this.storageUsed.set(`${bytes(u.used)} of ${bytes(u.quota)}`);
  }

  // ── account ──────────────────────────────────────────────────────────────
  async signIn(): Promise<void> {
    try {
      await this.auth.signIn(true);
      await this.sync.pull();
      await this.toast(this.t().syncedToast);
    } catch (err: any) {
      await this.toast(err?.message ?? 'Sign-in failed.', 'danger');
    }
  }

  async signOut(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.t().signOutTitle,
      message: this.t().signOutBody,
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().signOut,
          role: 'destructive',
          handler: () => {
            this.auth.signOut();
            this.sync.resetSession();
          },
        },
      ],
    });
    await alert.present();
  }

  async syncNow(): Promise<void> {
    if (!this.auth.isSignedIn()) {
      await this.toast('Sign in first.', 'warning');
      return;
    }
    await this.sync.pull();
    this.player.refreshOpenBook();
    await this.toast(
      this.sync.state() === 'error'
        ? this.sync.lastError() ?? 'Sync failed.'
        : this.t().syncedToast,
      this.sync.state() === 'error' ? 'danger' : 'success'
    );
  }

  // ── the hold ─────────────────────────────────────────────────────────────
  async clearHold(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.t().emptyOfflineTitle,
      message: this.t().emptyOfflineBody(this.stowedCount()),
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().emptyOffline,
          role: 'destructive',
          handler: () => {
            void this.offline.clearAll().then(() => this.readStorage());
          },
        },
      ],
    });
    await alert.present();
  }

  async askPersistence(): Promise<void> {
    const granted = await this.offline.requestPersistence();
    this.persistent.set(granted);
    await this.toast(
      granted
        ? 'Downloads are protected from eviction.'
        : 'The browser would not promise. Install the app and try again.',
      granted ? 'success' : 'warning'
    );
  }

  // ── backup ───────────────────────────────────────────────────────────────
  exportChest(): void {
    this.backup.export();
  }

  async importChest(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await this.backup.import(file);
    } catch (err: any) {
      await this.toast(err?.message ?? 'That backup file could not be read.', 'danger');
    }
  }

  async wipeLocal(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.t().wipeTitle,
      message: this.t().wipeBody,
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().wipeAction,
          role: 'destructive',
          handler: () => this.backup.wipeLocal(),
        },
      ],
    });
    await alert.present();
  }

  setTheme(mode: ThemeMode): void {
    this.settings.mode.set(mode);
  }

  async toggleDiagnostics(): Promise<void> {
    const next = !this.showDiagnostics();
    this.showDiagnostics.set(next);
    if (next) this.diagnostics.set(await this.install.diagnostics());
  }

  async doInstall(): Promise<void> {
    const outcome = await this.install.promptInstall();
    if (outcome === 'accepted') await this.toast(this.t().installedTitle);
    else if (outcome === 'unavailable') {
      await this.toast('The browser withdrew the install offer. Reload and try again.', 'warning');
    }
  }

  setSkin(skin: Skin): void {
    this.settings.skin.set(skin);
  }

  /** Lowering the ceiling should take effect now, not at the next download. */
  async setBudget(gb: number): Promise<void> {
    this.settings.cacheBudgetGb.set(gb);
    await this.offline.enforceBudget();
    await this.readStorage();
  }

  private async toast(message: string, color = 'success'): Promise<void> {
    const t = await this.toasts.create({
      message,
      duration: 2600,
      color,
      position: 'top',
      cssClass: 'yb-toast',
    });
    await t.present();
  }
}
