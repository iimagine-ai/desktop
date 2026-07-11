# IIMAGINE Desktop — Style Guide

Reference: "LUMEN" glass dashboard design. All UI in the desktop companion must follow these rules.

## Dependencies

- **Tailwind CSS** via CDN (`https://cdn.tailwindcss.com`)
- **Iconify** for icons (`https://code.iconify.design/iconify-icon/1.0.8/iconify-icon.min.js`)
- **Inter** font from Google Fonts, weights: 400, 500, 600

```html
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://code.iconify.design/iconify-icon/1.0.8/iconify-icon.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

## Colors

| Token | Value | Usage |
|---|---|---|
| Page background | `#fafafa` | Body bg |
| Text primary | `text-neutral-900` | Headings, labels |
| Text secondary | `text-neutral-500` | Descriptions, meta |
| Text muted | `text-neutral-400` | Hints, section labels |
| Border | `border-neutral-200/40` | Cards, dividers |
| White overlay | `bg-white/40` to `bg-white/60` | Glass panels |

## Typography

```css
body { font-family: 'Inter', sans-serif; }
```

| Element | Class |
|---|---|
| Page title | `text-xl lg:text-2xl font-semibold tracking-tight text-neutral-900` |
| Section heading | `text-base font-semibold text-neutral-900` |
| Card label | `text-xs font-medium uppercase tracking-wider text-neutral-500` |
| Body text | `text-sm text-neutral-500` or `text-sm font-medium text-neutral-900` |
| Nav section label | `text-xs font-medium text-neutral-400 uppercase tracking-widest` |
| Nav item text | `text-sm font-medium` |

## Ambient Background

Five floating gradient blobs behind all content. They use `position: fixed`, `blur(100-130px)`, `opacity-80`, and slow float animations (25-38s).

```html
<div class="fixed inset-0 z-0 overflow-hidden pointer-events-none opacity-80">
  <!-- Blue/Cyan -->
  <div class="absolute -top-[10%] -left-[10%] w-[50vw] h-[50vw] rounded-full
    bg-gradient-to-tr from-blue-100/70 to-indigo-50/40 blur-[100px]"
    style="animation: float1 25s ease-in-out infinite;"></div>
  <!-- Purple/Fuchsia -->
  <div class="absolute top-[10%] -right-[10%] w-[60vw] h-[55vw] rounded-[30rem]
    bg-gradient-to-bl from-purple-100/60 to-fuchsia-100/40 blur-[120px]"
    style="animation: float2 32s ease-in-out infinite;"></div>
  <!-- Rose/Amber -->
  <div class="absolute top-[30%] left-[20%] w-[45vw] h-[35vw] rounded-[40rem]
    bg-gradient-to-tr from-rose-100/50 to-amber-50/40 blur-[110px]"
    style="animation: float4 38s ease-in-out infinite;"></div>
  <!-- Mint/Emerald -->
  <div class="absolute -bottom-[20%] right-[15%] w-[55vw] h-[50vw] rounded-[35rem]
    bg-gradient-to-tl from-emerald-100/50 to-teal-50/30 blur-[100px]"
    style="animation: float5 28s ease-in-out infinite;"></div>
  <!-- Violet base -->
  <div class="absolute -bottom-[30%] -left-[10%] w-[70vw] h-[70vw] rounded-full
    bg-gradient-to-tr from-violet-100/60 to-transparent blur-[130px]"
    style="animation: float3 35s ease-in-out infinite;"></div>
</div>
```

Required keyframes:

```css
@keyframes float1 {
  0% { transform: translate(0, 0) scale(1) rotate(0deg); }
  33% { transform: translate(5%, 5%) scale(1.05) rotate(5deg); }
  66% { transform: translate(-2%, 8%) scale(0.95) rotate(-5deg); }
  100% { transform: translate(0, 0) scale(1) rotate(0deg); }
}
@keyframes float2 {
  0% { transform: translate(0, 0) scale(1) rotate(0deg); }
  33% { transform: translate(-5%, -10%) scale(0.95) rotate(-10deg); }
  66% { transform: translate(4%, -5%) scale(1.05) rotate(5deg); }
  100% { transform: translate(0, 0) scale(1) rotate(0deg); }
}
@keyframes float3 {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(8%, -4%) scale(1.1); }
  100% { transform: translate(0, 0) scale(1); }
}
@keyframes float4 {
  0% { transform: translate(0, 0) scale(1) rotate(0deg); }
  50% { transform: translate(-10%, 15%) scale(1.15) rotate(180deg); }
  100% { transform: translate(0, 0) scale(1) rotate(360deg); }
}
@keyframes float5 {
  0% { transform: translate(0, 0) scale(1) rotate(0deg); }
  50% { transform: translate(12%, -12%) scale(0.85) rotate(-90deg); }
  100% { transform: translate(0, 0) scale(1) rotate(-180deg); }
}
```

## Glass Container (outer shell)

The entire app sits inside one glass container with padding from the viewport edge.

```html
<div class="relative z-10 flex h-full w-full p-2 sm:p-4 lg:p-6">
  <div class="flex w-full h-full bg-white/40 backdrop-blur-2xl
    border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)]
    rounded-[1.5rem] lg:rounded-[2rem] overflow-hidden">
    <!-- sidebar + main -->
  </div>
</div>
```

## Sidebar

- Width: `w-64`
- Background: `bg-white/20` with `border-r border-neutral-200/40`
- Logo area: `h-20`, `px-8`, logo is a small dark rounded square with white dot + spaced text
- Nav items: `px-4 py-2.5 rounded-xl text-sm font-medium`
- Active nav: `bg-white/60 text-neutral-900 shadow-sm border border-white/50`
- Inactive nav: `text-neutral-500 hover:text-neutral-900 hover:bg-white/40`
- Icons: Iconify Solar Linear set, `text-xl`, with `group-hover:scale-110 transition-transform`
- User area: bottom, `border-t border-neutral-200/40`, avatar + name + email

### Icon set (Solar Linear)

| Page | Icon |
|---|---|
| Chat | `solar:chat-round-dots-linear` |
| Images | `solar:gallery-wide-linear` |
| Videos | `solar:videocamera-record-linear` |
| Knowledge | `solar:book-bookmark-linear` |
| Assistants | `solar:users-group-rounded-linear` |
| Settings | `solar:settings-linear` |

## Header

- Height: `h-20`
- Border: `border-b border-neutral-200/30`
- Title: `text-xl lg:text-2xl font-semibold tracking-tight text-neutral-900`

## Cards

```
bg-white/50 border border-neutral-200/40 rounded-2xl p-5
shadow-[0_2px_10px_rgb(0,0,0,0.02)] backdrop-blur-md
hover:bg-white/80 transition-all
```

## Buttons

### Primary (dark)

```
px-4 py-2.5 rounded-lg bg-neutral-900 text-sm font-medium text-white
hover:bg-neutral-800 transition-all shadow-sm
```

### Secondary (glass)

```
px-4 py-2.5 rounded-lg bg-white/60 border border-neutral-200/50
text-sm font-medium text-neutral-700
hover:bg-white/90 transition-all shadow-sm
```

### Tertiary (outline)

```
w-full py-2.5 px-4 bg-white/80 border border-neutral-200
text-sm font-medium text-neutral-700 rounded-xl
hover:bg-neutral-50 hover:text-neutral-900 transition-all shadow-sm
```

## Inputs

```
bg-white/60 border border-neutral-200/50 rounded-full px-4 py-2
text-sm text-neutral-700 placeholder-neutral-400
focus-within:bg-white/90 transition-all shadow-sm
```

For textareas and selects, use `rounded-xl` instead of `rounded-full`.

## Status Badges

- Success: `bg-emerald-50 text-emerald-700 border border-emerald-100` with green dot
- Warning: `bg-amber-50 text-amber-700 border border-amber-100` with amber dot
- Error: `bg-rose-50 text-rose-700 border border-rose-100` with rose dot
- Neutral: `bg-neutral-100 text-neutral-500 border border-neutral-200`

## Toggle Switch

```css
/* Peer-checked = neutral-900 bg, unchecked = neutral-200 bg */
w-9 h-5 bg-neutral-200 rounded-full
peer-checked:bg-neutral-900
after:w-4 after:h-4 after:bg-white after:rounded-full
```

## Progress Bars

```
bg-neutral-100 rounded-full h-2 shadow-inner
/* Fill: */ bg-gradient-to-r from-neutral-600 to-neutral-900 h-2 rounded-full
```

## Scrollbar

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.1); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.2); }
```

## Spacing Rules

- Outer padding: `p-2 sm:p-4 lg:p-6` (viewport to glass shell)
- Content padding: `p-6 lg:p-10`
- Card grid gap: `gap-4`
- Section gap: `mb-8`

## Electron-specific

- Titlebar area uses `-webkit-app-region: drag` on the header
- Buttons/inputs inside titlebar use `-webkit-app-region: no-drag`
