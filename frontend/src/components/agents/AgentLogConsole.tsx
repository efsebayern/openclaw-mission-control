import { useEffect, useState, useRef } from "react";
import { getApiBaseUrl } from "@/lib/api-base";
import { getLocalAuthToken, isLocalAuthMode } from "@/auth/localAuth";

type AgentLog = {
  timestamp?: string;
  level?: string;
  message: string;
  session_id?: string;
  agent_id?: string;
};

type AgentLogConsoleProps = {
  agentId: string;
};

export function AgentLogConsole({ agentId }: AgentLogConsoleProps) {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "error" | "closed">("connecting");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    const token = isLocalAuthMode() ? getLocalAuthToken() : null;
    
    // Note: EventSource doesn't support custom headers easily. 
    // If Clerk/localAuth is used, the backend needs to support token in query param 
    // or we use a library like fetch-event-source.
    // For now, we attempt standard EventSource.
    const url = new URL(`${baseUrl}/api/v1/agents/${agentId}/logs/stream`);
    if (token) url.searchParams.set("token", token);

    const eventSource = new EventSource(url.toString());

    eventSource.onopen = () => {
      setStatus("connected");
    };

    eventSource.onerror = (e) => {
      console.error("SSE Error:", e);
      setStatus("error");
      eventSource.close();
    };

    eventSource.addEventListener("log", (event) => {
      try {
        const data = JSON.parse(event.data);
        setLogs((prev) => [...prev.slice(-199), data]);
      } catch (err) {
        console.error("Failed to parse log data", err);
      }
    });

    return () => {
      eventSource.close();
    };
  }, [agentId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden font-mono text-[11px] md:text-xs">
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">agent_logs_stream.tty</span>
          <span className={`w-2 h-2 rounded-full ${
            status === "connected" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : 
            status === "connecting" ? "bg-yellow-500 animate-pulse" : "bg-red-500"
          }`} title={status} />
        </div>
        <div className="flex gap-1.5">
          <button 
            onClick={() => setLogs([])}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors mr-2"
          >
            Clear
          </button>
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/20" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/20" />
        </div>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto space-y-0.5 text-slate-300 scroll-smooth"
      >
        {status === "connecting" && (
          <p className="text-slate-500 italic">Connecting to gateway stream...</p>
        )}
        {status === "error" && (
          <p className="text-red-400">!! Connection failed. Check gateway status or authentication.</p>
        )}
        {logs.length === 0 && status === "connected" && (
          <p className="text-slate-600 italic">Waiting for logs...</p>
        )}
        {logs.map((log, i) => (
          <div key={i} className="flex gap-3 group">
            <span className="text-slate-600 shrink-0 select-none">[{new Date().toLocaleTimeString()}]</span>
            <span className={
              log.level === "ERROR" ? "text-red-400" : 
              log.level === "WARN" ? "text-yellow-400" : 
              log.message?.includes("THINK") ? "text-purple-400 italic" : "text-slate-300"
            }>
              {log.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
