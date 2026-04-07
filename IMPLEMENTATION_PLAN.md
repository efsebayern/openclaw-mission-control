# Implementierungsplan: OpenClaw Mission Control Dashboard Anpassung

## 1. Zielsetzung
Anpassung des bestehenden `openclaw-mission-control` Dashboards, um OpenClaw Agents effizient zu verwalten, zu steuern und zu überwachen. Zusätzlich sollen Workflows und Agent Teams orchestriert werden können.

## 2. Analyse des aktuellen Dashboards
Das `openclaw-mission-control` Projekt ist in ein `backend` (Python/FastAPI) und ein `frontend` (Next.js/React) unterteilt. Es gibt bereits Endpunkte und UI-Komponenten für:
*   `agents`: Auflistung, Erstellung, Abrufen, Aktualisieren, Löschen, Heartbeat
*   `gateways`: Verwaltung von Gateways
*   `boards`: Verwaltung von Boards
*   `skills`: Verwaltung von Skills
*   `approvals`: Genehmigungen
*   `tasks`: Aufgabenverwaltung

**Wiederverwendbare Komponenten:**
*   **Backend:** FastAPI-Struktur, Datenbank-Integration (SQLModel), Authentifizierung/Autorisierung, AgentLifecycleService, Task-Management (ggf. Erweiterung).
*   **Frontend:** Next.js-Struktur, Routing, UI-Komponenten (Tabellen, Formulare, Layouts), API-Integration.

## 3. Benötigte Funktionen und Erweiterungen

### 3.1 Agent-Verwaltung und -Steuerung
*   **Agent-Übersicht:** Erweiterung der bestehenden Agentenliste (`/agents`), um detailliertere Statusinformationen (aktiv/inaktiv, aktuelle Aufgabe, Auslastung) anzuzeigen.
*   **Agent-Details:** Detaillierte Ansicht für einzelne Agents, inklusive:
    *   Echtzeit-Logs (Stream von Agent-Output).
    *   Metriken (CPU, Speicher, Uptime).
    *   Konfigurationsdetails.
    *   Manuelles Starten/Stoppen von Agents (falls implementierbar und sinnvoll über das Dashboard).
    *   Anzeige und Bearbeitung von Agent-spezifischen Umgebungsvariablen/Konfigurationen.
*   **Interaktion mit Agents:** Möglichkeit, Nachrichten an Agents zu senden oder Befehle auszuführen.

### 3.2 Workflow-Management
*   **Workflow-Definition:** UI zur Erstellung, Bearbeitung und Verwaltung von Workflows. Ein Workflow könnte eine Sequenz von Aufgaben oder eine logische Abfolge von Agent-Interaktionen sein.
    *   Visueller Workflow-Builder (optional, aber wünschenswert für bessere UX).
    *   Unterstützung für verschiedene Schritttypen (Agent-Task, Wartezeit, Bedingung, Schleife).
*   **Workflow-Ausführung:** Starten, Pausieren, Fortsetzen und Abbrechen von Workflows.
*   **Workflow-Überwachung:** Statusübersicht laufender Workflows, detaillierte Ansicht einzelner Workflow-Instanzen mit Log-Ausgabe und Fortschrittsanzeige.
*   **Workflow-Templates:** Möglichkeit, wiederverwendbare Workflow-Templates zu definieren.

### 3.3 Agent Team Orchestrierung
*   **Team-Definition:** UI zur Erstellung und Verwaltung von Agent Teams.
    *   Zuweisung von Agents zu Teams.
    *   Definition von Team-Rollen oder -Fähigkeiten.
*   **Aufgabenverteilung:** Implementierung von Logik zur intelligenten Aufgabenverteilung innerhalb eines Teams (z.B. Load Balancing, Fähigkeits-Matching).
*   **Team-Workflows:** Workflows, die auf Agent Teams statt auf einzelne Agents abzielen.

## 4. Technische Betrachtung

### 4.1 Backend (Python/FastAPI)
*   **Neue API-Endpunkte:**
    *   `GET /agents/{agent_id}/logs`: Für das Streamen von Agent-Logs.
    *   `GET /agents/{agent_id}/metrics`: Für Leistungsmetriken.
    *   `POST /agents/{agent_id}/command`: Zum Senden von Befehlen an einen Agent.
    *   `CRUD /workflows`: Für Workflow-Definitionen.
    *   `CRUD /workflow_instances`: Für die Verwaltung laufender Workflow-Instanzen.
    *   `CRUD /agent_teams`: Für die Definition von Agent Teams.
*   **Datenbank-Modelle:** Neue SQLModel-Modelle für Workflows, Workflow-Instanzen, Agent Teams und deren Beziehungen.
*   **OpenClaw Gateway Integration:** Erweiterung des `AgentLifecycleService` und des `GatewayService`, um die neuen Steuerungs- und Überwachungsfunktionen zu integrieren. Dies erfordert möglicherweise die Nutzung oder Erweiterung des OpenClaw RPC-Protokolls.
*   **Coolify Integration:** Ein Coolify-Client im Backend, der die `coolify-cli` über `exec` aufruft oder eine Python-Bibliothek nutzt, um:
    *   Status von Deployments abzurufen.
    *   Umgebungsvariablen zu setzen/ändern (für API-Keys etc.).
    *   Services neu zu starten.

### 4.2 Frontend (Next.js/React)
*   **Neue Seiten/Ansichten:**
    *   `/agents/{agent_id}/monitor`: Seite für Agent-Details, Logs und Metriken.
    *   `/workflows`: Übersicht aller Workflows.
    *   `/workflows/new` / `/workflows/{workflow_id}`: Workflow-Editor (ggf. mit Drag-and-Drop).
    *   `/agent-teams`: Übersicht und Verwaltung von Agent Teams.
*   **Komponenten:**
    *   Echtzeit-Log-Viewer (mit SSE-Unterstützung).
    *   Diagramme für Metriken (z.B. mit Recharts oder Nivo).
    *   Formulare zur Workflow-Definition und Team-Zuweisung.
*   **State Management:** Anpassung des Frontend-State-Managements, um die neuen Datenmodelle zu handhaben.
*   **API-Client:** Aktualisierung des generierten API-Clients (z.B. mit Orval), um die neuen Backend-Endpunkte zu nutzen.

## 5. Deployment und Umgebung
*   Das Dashboard wird im Coolify Deployer gehostet.
*   Der Coolify API-Key muss als Umgebungsvariable im Linux-System verfügbar sein, in dem das Backend läuft.
*   Die `coolify-cli` muss auf dem System installiert sein, auf dem das Backend läuft, falls direkte CLI-Aufrufe erfolgen.

## 6. Implementierungsphasen (Grobe Reihenfolge)

### Phase 1: Grundlagen und Agent-Überwachung
1.  **Backend:**
    *   Erweiterung der Agent-Modelle um detailliertere Statusfelder.
    *   Implementierung von `GET /agents/{agent_id}/logs` (initialer Pull, später SSE).
    *   Implementierung von `GET /agents/{agent_id}/metrics`.
    *   Integration des Coolify-Clients für Deployment-Status und ENV-Variablen (Proof-of-Concept).
2.  **Frontend:**
    *   Erweiterung der Agentenliste um neue Statusinformationen.
    *   Erstellung der Agent-Detailseite (`/agents/{agent_id}/monitor`) mit Basisinformationen, Logs und Metriken.
    *   UI zur Anzeige des Coolify Deployment-Status für das Mission Control Dashboard selbst.

### Phase 2: Workflow-Management (Basis)
1.  **Backend:**
    *   Definition der SQLModel-Modelle für `Workflow` und `WorkflowInstance`.
    *   Implementierung der `CRUD /workflows` API-Endpunkte.
    *   Initialer Workflow-Executor (einfache sequentielle Ausführung von Agent-Tasks).
2.  **Frontend:**
    *   Workflow-Übersichtsseite (`/workflows`).
    *   Formular zur Erstellung/Bearbeitung einfacher sequentieller Workflows.
    *   Ansicht für laufende Workflow-Instanzen.

### Phase 3: Agent Team Orchestrierung und Erweiterte Workflows
1.  **Backend:**
    *   Definition des SQLModel-Modells für `AgentTeam`.
    *   Implementierung der `CRUD /agent_teams` API-Endpunkte.
    *   Erweiterung des Workflow-Executors um Team-basierte Aufgabenverteilung und komplexere Schritttypen.
2.  **Frontend:**
    *   Agent Team Management Seite (`/agent-teams`).
    *   Integration der Team-Auswahl in den Workflow-Editor.
    *   Verbesserung des Workflow-Editors (z.B. einfacher visueller Editor).

### Phase 4: Verfeinerung und zusätzliche Features
1.  **Backend:**
    *   Implementierung von Realtime-Updates für Logs und Metriken via SSE.
    *   Erweiterte Fehlerbehandlung und Benachrichtigungen.
2.  **Frontend:**
    *   Interaktive Diagramme.
    *   Umfassende Such- und Filterfunktionen.
    *   User-Interface für die Interaktion mit Agents.

## 7. Risiken und Herausforderungen
*   **Komplexität der Agent-Interaktion:** Das Design eines robusten und flexiblen Interaktionsmodells für OpenClaw Agents.
*   **Echtzeit-Daten:** Effiziente Bereitstellung und Darstellung von Echtzeit-Logs und Metriken.
*   **Coolify Integration:** Abhängigkeit von der Coolify API/CLI und deren Stabilität.
*   **Skalierbarkeit:** Sicherstellen, dass das Dashboard auch bei einer großen Anzahl von Agents und Workflows performant bleibt.

Dieser Plan dient als Leitfaden und wird im Laufe des Projekts iterativ verfeinert und angepasst.
