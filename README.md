# OpenClaw Hub

OpenClaw Hub is a local-first Electron desktop app built to serve as a **mission control center** for AI chats, agents, integrations, notifications, and workflow status.

The goal is to move beyond a basic multi-tab AI shell and turn the app into something you can leave open all day as a real operational dashboard: one place to launch tools, monitor services, manage chats, and keep important project context visible.

---

## What OpenClaw Hub Is

OpenClaw Hub is designed to unify several things into one desktop workspace:

- AI chat and assistant workflows
- OpenClaw-related gateway/client integration
- Google-connected utilities and personal workflow helpers
- local data, settings, and history
- status monitoring and quick-launch controls
- future agent-based task workflows

Instead of treating every feature as a separate disconnected tab, the long-term plan is to center everything around **Mission Control**.

---

## Main Direction

The app is evolving toward a model where **Mission Control** becomes the primary home screen and the main way you interact with the system.

That means the app should answer these questions immediately:

- What is connected and working?
- What needs attention right now?
- Which chat, project, or agent is active?
- What happened recently?
- What can I launch in one click?

This shift is what gives the project a stronger identity.

---

## Core Features

### Desktop App Foundation
- Electron-based desktop app
- local-first structure
- modular layout for feature expansion
- persistent desktop-style workflow

### Chat + AI Workflow
- built-in chat interface
- OpenAI integration
- support for AI-assisted workflows
- foundation for multiple specialized agents

### Mission Control
- central dashboard for status, activity, and quick actions
- intended to become the default landing page
- designed to surface the most important information first

### Integrations
- OpenClaw gateway/client foundations
- Google-related integration groundwork
- notifications and utility modules
- local config and app data structure

### Project-Oriented Expansion
- designed to grow into a daily-use command center
- supports experiments with tabs, tools, agents, and workflow modules
- structured to evolve without needing a full rebuild

---

## Project Structure

```text
OpenClaw-Hub/
├── assets/               # Icons and app assets
├── config/               # Configuration files
├── data/                 # Local application data
├── modules/              # Feature modules
├── styles/               # CSS and styling
├── ui/                   # UI components/views
├── index.html            # Main renderer HTML
├── main.js               # Electron main process
├── preload.js            # Secure IPC bridge
├── renderer.js           # Renderer logic
├── gatewayClient.js      # Gateway / backend communication layer
├── google.js             # Google-related integration logic
├── chat.js               # Chat logic
├── launcher.js           # App startup / launch behavior
├── notifications.js      # Notification handling
└── package.json          # Project metadata and scripts

## 📸 Screenshots

Here's a look at the current interface:

| Main Dashboard | API & Settings | Chat History |
| :---: | :---: | :---: |
| ![Main Dashboard](https://i.imgur.com/lmj9MUv.png) | ![API & Settings](https://i.imgur.com/WgJ4cF1.png) | ![Chat History](https://i.imgur.com/UZaaGXx.png) |


Vision

The long-term goal is to make OpenClaw Hub feel less like a collection of experiments and more like a real desktop control center.

That means:

a strong home dashboard

visible connection and service health

better session continuity

fast access to tools and agents

activity and error visibility

cleaner structure for future expansion

Mission Control is the piece that ties all of that together.

Mission Control Concept

Mission Control is intended to become the operational heart of the app.

Planned Panels
1. System Health

A quick-glance view of whether core services are working.

Examples:

OpenClaw gateway status

OpenAI/API status

Google connection status

CPU / memory indicators

local services available or unavailable

2. Active Workspace

A snapshot of what the user is currently doing.

Examples:

active project

selected chat

current model/provider

active agent

current task focus

3. Inbox / Events

A small high-value area for time-sensitive items.

Examples:

unread email count

next calendar event

recent notifications

important reminders

4. Activity Feed

A running stream of recent app activity.

Examples:

last prompts

last launches

last errors

reconnect attempts

recent actions across modules

5. Quick Actions

A launch area for the most common actions.

Examples:

open chat

reconnect gateway

open history

export transcript

open API settings

launch agent tools

Why This Project Exists

A lot of AI tools feel fragmented:

one app for chat

another for email

another for scheduling

another for automation

another for experiments

OpenClaw Hub is meant to reduce that fragmentation by giving those workflows a shared front end and a shared operational center.

The aim is not just “more tabs,” but a more usable daily environment.

Current Priorities

The next stage is not mainly about piling on features. It is about making the project more coherent and more usable.

Current priorities:

Make Mission Control the true default home screen

Improve service visibility and status reporting

Add recent activity and error tracking

tighten repo structure and documentation

improve layout and space usage

make the app feel more intentional and less placeholder-driven

Installation
Requirements

Node.js 18 or newer recommended

npm

desktop environment capable of running Electron

Clone the repository
git clone https://github.com/mdbahr74/OpenClaw-Hub.git
cd OpenClaw-Hub
Install dependencies
npm install
Start the app
npm start
Build / package

Packaging flow is still being refined and can be documented here once finalized.

Configuration Notes

This project uses local config and app data patterns and may rely on credentials or integration setup for some features.

Before wider distribution, it is a good idea to:

verify .gitignore coverage for all local-only and secret files

remove backup files from the repo

document required credentials and setup steps

document which features are stable versus experimental

Development Notes

This project is actively evolving.

Some parts are already functional.
Some parts are scaffolding.
Some parts are being reshaped as the overall product direction becomes clearer.

The main focus right now is:

improving structure

improving readability

improving startup experience

improving layout

improving connection visibility

turning Mission Control into the center of the product

Roadmap Summary
Phase 1 — Foundation Cleanup

clean repo structure

remove backup files

fix naming consistency

tighten ignore rules

improve setup and docs

improve readability in core files

Phase 2 — Mission Control First

make Mission Control the main landing page

add service health indicators

add activity feed

add quick actions

expose active workspace context

Phase 3 — Agent Workflow Expansion

add agent cards / launchers

improve provider/model visibility

support specialized agent workflows

connect agent state to Mission Control

Phase 4 — Daily Driver Usability

session restore

detached window restoration

better notifications

cleaner startup behavior

smoother layout and navigation

Phase 5 — Deeper Integrations

stronger Google integration

richer gateway integration

better status reporting

more persistent workflow context

Contributing

The project is still evolving quickly, so contributions, issue reports, and ideas are welcome as the structure becomes cleaner and the public setup process becomes easier to follow.
