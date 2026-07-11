# Installing and Managing Models

## Important: Read This First

Running AI models locally is very resource intensive. Choosing a model that exceeds your hardware's capabilities can freeze or crash your computer. Please take a moment to understand how this works before downloading a model.

**How models use your computer's resources:**

- When you download a model, it is saved to your hard drive or SSD (storage). This is similar to downloading any large file — it takes up disk space but does not affect performance.
- When you activate a model (by selecting it or sending a message), the entire model is loaded from storage into your computer's RAM (memory). While active, the model occupies that memory and it is unavailable to your other applications.
- A common mistake is assuming that 16 GB of RAM is enough to run a model that requires 16 GB. It is not. Your operating system, browser, and other applications also need memory to function. If a model consumes all available RAM, your computer will become unresponsive or crash. 

IIMAGINE automatically manages the activation and deactivation of models in order to optimize your computer's resources but you must still select models that fit into the available RAM after deducting the amount of RAM required for all other processes that will be running concurrently.  

**We strongly recommend using the guided workflow** (Find the Right Model) to select a model. It automatically scans your hardware and only recommends models that will run safely on your machine. This removes the guesswork entirely.

**You can download multiple models** and use different ones for different tasks — for example, a small fast model for quick chat and a larger model for deep analysis. You switch between them using the model selector in the top left. See the sections below for how to download, switch, and manage multiple models.

---

## Overview

Models are the AI engines that power everything in the desktop app — chat, knowledge base queries, assistants, and more. All models run locally on your machine, meaning your data never leaves your computer.

You can download multiple models and switch between them depending on what you're working on. Only one model is active in memory at a time to keep your system running smoothly.

## Finding and Installing a Model

### Guided Workflow (Recommended)

The easiest way to get started is the **Find the Right Model** option in Settings → Models. This guided workflow will:

1. Ask what you need the model for (text/chat, coding, reasoning, multimodal, image, embedding)
2. Automatically scan your machine's hardware (RAM, GPU, available disk space)
3. Score and recommend the best models that will run well on your specific hardware
4. Let you download your chosen model with a single click

We recommend this approach for most users. It removes the guesswork about which models will actually perform well on your machine.

### Advanced: Browse All Models

If you already know what you want, use the **Browse All Models** option. This gives you a searchable, filterable table of all available models. You can also enter any model ID directly if you want something not listed in the catalog.

### Downloading

When you select a model to download, a progress bar appears in the model card showing download status. Model sizes typically range from 1.5 GB to 8 GB depending on the model and quantization level. Make sure you have sufficient disk space before downloading.

## Selecting and Switching Models

### The Model Selector

The **model selector** is located in the top left of the sidebar. It shows the currently active model and lets you switch to any downloaded model with a single click.

When you select a different model:

- The previously active model is unloaded from memory
- The new model is loaded into memory
- A brief progress indicator appears in the selector while the switch happens

There is a brief time lag between deactivating one model and activating another. This is by design — the app ensures that no more than one model is concurrently active in your computer's memory. This optimises memory usage across your entire desktop so other applications aren't affected.

On Apple Silicon Macs, switching typically takes 1–4 seconds depending on model size. On Windows machines with slower storage, it may take longer.

### Multiple Models for Different Tasks

You can download as many models as your disk space allows and switch between them for different use cases. For example:

- A fast, small model for quick chat and brainstorming
- A larger reasoning model for complex analysis
- A coding-focused model for programming tasks

Switch between them at any time from the model selector without leaving the screen you're working on.

## Memory Management

### Automatic Unloading

If a model is not used, it will be automatically unloaded from memory after **two minutes** of inactivity. This is the default setting and ensures your machine's RAM is freed up when you're not actively using AI.

Keep in mind: if you set the unload timer to a longer period (or "Never"), the model will remain in memory consuming RAM for no reason during idle time. For most users, the 2-minute default strikes the right balance between responsiveness and memory efficiency.

### Adjusting the Unload Timer

To change how long an inactive model stays loaded:

1. Go to **Settings → Models**
2. Expand **Advanced Options**
3. Find **Memory Unload Timer**
4. Choose from: 1 minute, 2 minutes, 5 minutes, 10 minutes, 30 minutes, or Never

### Monitoring Active Models

You can see which models are currently loaded in memory by viewing the **Runtime Status** section in Settings → Models. This shows:

- Which model is currently loaded
- How long it has been active
- Memory usage

## Model Updates

### How Updates Work

The app maintains a model registry that tracks the latest available models. On each launch, it checks for updates to this registry in the background.

### Update Notifications

When new models become available or existing models receive significant updates, a notification banner appears at the top of the Models section in Settings. The banner tells you how many new models have been added since you last checked.

You can:

- Click the banner to view what's new
- Dismiss the notification if you're not interested

Update checks happen automatically on app startup and do not interrupt your workflow. No models are downloaded or changed without your explicit action — the notification simply lets you know new options are available.

## Deleting Models

To free up disk space, you can delete models you no longer need:

1. Go to **Settings → Models**
2. Find the model in your installed models list
3. Click the delete option

Deleting a model removes it from disk entirely. You can always re-download it later if needed.

## Model Storage Location

Models are stored locally on your machine. You can view and open the storage directory from **Settings → Models → Advanced Options → Model Storage Location**. This is useful if you need to check disk usage or manually manage files.

## Troubleshooting

**Model selector shows "No models"**: The AI engine may not be running. Check the engine status indicator in Settings → Models. If it shows as offline, click the install/start button.

**Download seems stuck**: Large models can take several minutes to download depending on your internet connection. The progress bar should continue moving. If it stops completely, try cancelling and restarting the download.

**Model loads slowly**: Load time depends on your storage speed. SSDs load models much faster than traditional hard drives. On Apple Silicon Macs with fast internal storage, even large models load in under 4 seconds.

**Running out of memory**: If your machine feels slow while a model is active, try switching to a smaller model or reducing the memory unload timer to 1 minute so the model frees RAM more quickly when idle.
