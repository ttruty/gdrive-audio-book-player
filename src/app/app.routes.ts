import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'tabs',
    loadComponent: () => import('./pages/tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'hold',
        loadComponent: () =>
          import('./pages/shelf/shelf.page').then((m) => m.ShelfPage),
      },
      {
        path: 'log',
        loadComponent: () => import('./pages/log/log.page').then((m) => m.LogPage),
      },
      {
        path: 'charts',
        loadComponent: () =>
          import('./pages/charts/charts.page').then((m) => m.ChartsPage),
      },
      {
        path: 'book/:id',
        loadComponent: () => import('./pages/book/book.page').then((m) => m.BookPage),
      },
      { path: '', redirectTo: 'hold', pathMatch: 'full' },
    ],
  },
  {
    // The Helm sits outside the tabs so the now-playing view is full-bleed.
    path: 'helm',
    loadComponent: () =>
      import('./pages/player/player.page').then((m) => m.PlayerPage),
  },
  { path: '', redirectTo: 'tabs/hold', pathMatch: 'full' },
  { path: '**', redirectTo: 'tabs/hold' },
];
