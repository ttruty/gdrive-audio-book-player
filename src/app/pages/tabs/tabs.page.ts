import { Component, inject } from '@angular/core';
import {
  IonIcon,
  IonLabel,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { boat, compass, journal, library } from 'ionicons/icons';

import { MiniPlayerComponent } from '../../components/mini-player.component';
import { CopyService } from '../../services/copy.service';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, MiniPlayerComponent],
  template: `
    <ion-tabs>
      <!-- Both live in the bottom slot; the mini-player rides above the bar. -->
      <app-mini-player slot="bottom" />

      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="hold">
          <ion-icon name="library" />
          <ion-label>{{ t().libraryTab }}</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="log">
          <ion-icon name="journal" />
          <ion-label>{{ t().notesTab }}</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="charts">
          <ion-icon name="compass" />
          <ion-label>{{ t().settingsTab }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [
    `
      ion-tab-bar {
        --background: var(--ion-toolbar-background);
        border-top: 1px solid var(--yb-hairline);
      }
      ion-tab-button {
        --color-selected: var(--ion-color-primary);
      }
      ion-label {
        font-family: var(--yb-legend-family);
        font-size: 0.7rem;
        letter-spacing: 0.04em;
      }
    `,
  ],
})
export class TabsPage {
  readonly t = inject(CopyService).t;

  constructor() {
    addIcons({ library, journal, compass, boat });
  }
}
