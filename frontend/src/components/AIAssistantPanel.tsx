import React, { useEffect, useRef, useState } from 'react';
import { askAIAssistant } from '../apiExtra';

type Message = {
  role: 'assistant' | 'user';
  content: string;
  timestamp: string;
};

const starterPrompts = [
  'Who was absent today?',
  'Summarize attendance by exam hall.',
  'Which students have repeated scan failures?',
  'What should officers do next?',
];

const capabilityCards = [
  {
    title: 'Attendance Intel',
    detail: 'Absences, hall coverage, late-arrival signals, and operational summaries.',
    accent: '#C9A84C',
  },
  {
    title: 'Anomaly Watch',
    detail: 'Duplicate scans, repeated failures, unusual gaps, and hall-level risk flags.',
    accent: '#DC2626',
  },
  {
    title: 'Officer Guidance',
    detail: 'Tactical next steps for enrollment, setup, monitoring, and reporting.',
    accent: '#0F766E',
  },
];

const formatTime = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dotStyle = (delay: string): React.CSSProperties => ({
  width: '8px',
  height: '8px',
  borderRadius: '999px',
  background: '#38BDF8',
  animation: `pulseDot 1.2s ${delay} infinite ease-in-out`,
});

const AIAssistantPanel: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'I am watching attendance records, sessions, and scan events in real time. Ask me about absences, hall-level trends, scan anomalies, or what your officers should do next.',
      timestamp: formatTime(),
    },
  ]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, loading]);

  const appendAssistantMessage = (content: string) => {
    setMessages((current) => [
      ...current,
      { role: 'assistant', content, timestamp: formatTime() },
    ]);
  };

  const handleAsk = async (prompt?: string) => {
    const nextQuestion = (prompt ?? question).trim();
    if (!nextQuestion || loading) return;

    setMessages((current) => [
      ...current,
      { role: 'user', content: nextQuestion, timestamp: formatTime() },
    ]);
    setQuestion('');
    setLoading(true);

    try {
      const response = await askAIAssistant(nextQuestion);
      appendAssistantMessage(response.answer);
    } catch (error) {
      appendAssistantMessage('I could not reach the AI service. Make sure the backend is running on port 4000.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-enter"
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '28px',
        background:
          'linear-gradient(145deg, rgba(15,23,42,0.94) 0%, rgba(30,41,59,0.92) 45%, rgba(15,118,110,0.88) 100%)',
        boxShadow: '0 28px 60px rgba(15, 23, 42, 0.28)',
        border: '1px solid rgba(148, 163, 184, 0.22)',
      }}
    >
      <style>{`
        @keyframes pulseDot {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.35; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at top left, rgba(56,189,248,0.18), transparent 32%), radial-gradient(circle at bottom right, rgba(45,212,191,0.16), transparent 28%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', padding: '1.5rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.15fr 0.85fr',
            gap: '1.25rem',
            alignItems: 'stretch',
          }}
        >
          <div
            style={{
              borderRadius: '24px',
              padding: '1.5rem',
              background: 'var(--border)',
              border: '1px solid var(--border)',
              backdropFilter: 'blur(16px)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '1rem',
                marginBottom: '1.25rem',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    borderRadius: '999px',
                    background: 'rgba(14, 165, 233, 0.16)',
                    color: '#BAE6FD',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    marginBottom: '0.85rem',
                  }}
                >
                  <span
                    style={{
                      width: '9px',
                      height: '9px',
                      borderRadius: '999px',
                      background: '#22C55E',
                      boxShadow: '0 0 16px rgba(34,197,94,0.6)',
                    }}
                  />
                  Live AI Console
                </div>
                <h3 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.8rem', lineHeight: 1.1 }}>
                  Exam Operations Copilot
                </h3>
                <p style={{ margin: '0.65rem 0 0', color: 'var(--muted)', maxWidth: '700px', lineHeight: 1.55 }}>
                  A conversational control room for admins and officers. It translates attendance data into plain-language
                  answers, flags risk patterns, and helps your team decide what to do next.
                </p>
              </div>

              <div
                style={{
                  minWidth: '210px',
                  borderRadius: '18px',
                  padding: '1rem',
                  background: 'linear-gradient(145deg, rgba(8,47,73,0.72), rgba(15,118,110,0.48))',
                  border: '1px solid rgba(125, 211, 252, 0.2)',
                }}
              >
                <div style={{ color: '#7DD3FC', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Assistant State
                </div>
                <div style={{ color: '#F8FAFC', fontSize: '1.05rem', fontWeight: 700, marginTop: '0.4rem' }}>
                  Monitoring in context
                </div>
                <div style={{ color: '#CFFAFE', marginTop: '0.45rem', lineHeight: 1.45, fontSize: '0.92rem' }}>
                  Watching students, sessions, attendance events, and scan activity.
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.85rem',
              }}
            >
              {capabilityCards.map((card) => (
                <div
                  key={card.title}
                  style={{
                    borderRadius: '18px',
                    padding: '1rem',
                    background: 'rgba(15, 23, 42, 0.3)',
                    border: `1px solid ${card.accent}33`,
                    boxShadow: `inset 0 1px 0 ${card.accent}22`,
                  }}
                >
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '16px',
                      background: `${card.accent}22`,
                      color: card.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      marginBottom: '0.8rem',
                    }}
                  >
                    AI
                  </div>
                  <div style={{ color: '#F8FAFC', fontWeight: 700, marginBottom: '0.45rem' }}>{card.title}</div>
                  <div style={{ color: 'var(--muted)', lineHeight: 1.45, fontSize: '0.92rem' }}>{card.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              borderRadius: '24px',
              padding: '1.35rem',
              background: 'var(--border)',
              border: '1px solid var(--border)',
              backdropFilter: 'blur(16px)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ color: '#93C5FD', fontWeight: 700, fontSize: '0.82rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Suggested Questions
              </div>
              <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.75rem' }}>
                {starterPrompts.map((prompt, index) => (
                  <button
                    key={prompt}
                    onClick={() => handleAsk(prompt)}
                    disabled={loading}
                    style={{
                      textAlign: 'left',
                      padding: '0.95rem 1rem',
                      borderRadius: '16px',
                      border: '1px solid rgba(191, 219, 254, 0.22)',
                      background: 'var(--border)',
                      color: '#F8FAFC',
                      cursor: 'pointer',
                      transition: 'transform 0.2s ease, background 0.2s ease',
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.transform = 'translateY(-2px)';
                      event.currentTarget.style.background = 'rgba(59,130,246,0.16)';
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.transform = 'translateY(0)';
                      event.currentTarget.style.background = 'var(--border)';
                    }}
                  >
                    <div style={{ color: '#7DD3FC', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                      Prompt {index + 1}
                    </div>
                    <div style={{ fontWeight: 600, lineHeight: 1.4 }}>{prompt}</div>
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                marginTop: '1rem',
                borderRadius: '18px',
                padding: '1rem',
                background: 'linear-gradient(145deg, rgba(15,23,42,0.5), rgba(2,132,199,0.18))',
                border: '1px solid rgba(56,189,248,0.18)',
              }}
            >
              <div style={{ color: '#F8FAFC', fontWeight: 700 }}>What it feels like</div>
              <div style={{ color: 'var(--muted)', lineHeight: 1.45, marginTop: '0.45rem', fontSize: '0.92rem' }}>
                Fast chat responses, actionable language, and a visible sense that the system is actively helping staff run the exam floor.
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: '1.25rem',
            borderRadius: '26px',
            background: 'rgba(248, 250, 252, 0.96)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '1rem 1.25rem',
              borderBottom: '1px solid #E2E8F0',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(241,245,249,0.96))',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '16px',
                  background: 'linear-gradient(145deg, #C9A84C, #A68A2E)',
                  color: '#1a1a1a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  boxShadow: '0 12px 24px rgba(14,165,233,0.3)',
                }}
              >
                AI
              </div>
              <div>
                <div style={{ color: '#0F172A', fontWeight: 800 }}>Ops Dialogue</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Ask naturally. Get operational answers.</div>
              </div>
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.55rem',
                borderRadius: '999px',
                background: '#E0F2FE',
                color: '#075985',
                padding: '0.45rem 0.8rem',
                fontWeight: 700,
                fontSize: '0.82rem',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '999px',
                  background: '#22C55E',
                }}
              />
              Ready
            </div>
          </div>

          <div
            ref={scrollRef}
            style={{
              padding: '1.25rem',
              minHeight: '320px',
              maxHeight: '430px',
              overflowY: 'auto',
              background:
                'radial-gradient(circle at top, rgba(14,165,233,0.08), transparent 40%), linear-gradient(180deg, #0E0E3A 0%, #06062B 100%)',
            }}
          >
            {messages.map((message, index) => {
              const isAssistant = message.role === 'assistant';
              return (
                <div
                  key={`${message.timestamp}-${index}`}
                  style={{
                    display: 'flex',
                    justifyContent: isAssistant ? 'flex-start' : 'flex-end',
                    marginBottom: '1rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: isAssistant ? 'row' : 'row-reverse',
                      alignItems: 'flex-end',
                      gap: '0.75rem',
                      maxWidth: '88%',
                    }}
                  >
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '14px',
                        flexShrink: 0,
                        background: isAssistant
                          ? 'linear-gradient(145deg, #C9A84C, #A68A2E)'
                          : 'linear-gradient(145deg, #C9A84C, #A68A2E)',
                        color: '#1a1a1a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        boxShadow: isAssistant
                          ? '0 10px 20px rgba(14,165,233,0.24)'
                          : '0 10px 20px rgba(67,56,202,0.22)',
                      }}
                    >
                      {isAssistant ? 'AI' : 'You'}
                    </div>

                    <div>
                      <div
                        style={{
                          padding: '0.95rem 1rem',
                          borderRadius: isAssistant ? '20px 20px 20px 8px' : '20px 20px 8px 20px',
                          background: isAssistant ? '#FFFFFF' : 'linear-gradient(145deg, #C9A84C, #A68A2E)',
                          color: isAssistant ? '#0F172A' : '#FFFFFF',
                          border: isAssistant ? '1px solid #E2E8F0' : 'none',
                          boxShadow: isAssistant
                            ? '0 10px 24px rgba(148,163,184,0.16)'
                            : '0 14px 26px rgba(67,56,202,0.18)',
                          lineHeight: 1.55,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {message.content}
                      </div>
                      <div
                        style={{
                          marginTop: '0.35rem',
                          color: 'var(--muted)',
                          fontSize: '0.78rem',
                          textAlign: isAssistant ? 'left' : 'right',
                          padding: '0 0.25rem',
                        }}
                      >
                        {isAssistant ? 'Exam Operations Copilot' : 'You'} • {message.timestamp}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '14px',
                    background: 'linear-gradient(145deg, #C9A84C, #A68A2E)',
                    color: '#1a1a1a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                  }}
                >
                  AI
                </div>
                <div
                  style={{
                    padding: '0.95rem 1rem',
                    borderRadius: '20px 20px 20px 8px',
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    boxShadow: '0 10px 24px rgba(148,163,184,0.16)',
                  }}
                >
                  <div style={{ color: '#0F172A', fontWeight: 700, marginBottom: '0.45rem' }}>Thinking through the live data</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={dotStyle('0s')} />
                    <span style={dotStyle('0.15s')} />
                    <span style={dotStyle('0.3s')} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '1rem 1.15rem 1.15rem', borderTop: '1px solid #E2E8F0', background: '#FFFFFF' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '20px',
                background: 'rgba(255,255,255,0.04)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '14px',
                  background: '#E0F2FE',
                  color: '#0369A1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                →
              </div>

              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleAsk();
                  }
                }}
                placeholder="Ask about attendance risks, absent students, scan failures, or what officers should do next"
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: '0.98rem',
                  color: '#0F172A',
                }}
              />

              <button
                onClick={() => handleAsk()}
                disabled={loading}
                style={{
                  border: 'none',
                  borderRadius: '16px',
                  background: loading
                    ? 'linear-gradient(145deg, #94A3B8, #64748B)'
                    : 'linear-gradient(145deg, #C9A84C, #A68A2E)',
                  color: '#1a1a1a',
                  padding: '0.9rem 1.2rem',
                  fontWeight: 800,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: loading ? 'none' : '0 14px 28px rgba(20,184,166,0.24)',
                }}
              >
                Send
              </button>
            </div>

            <div
              style={{
                marginTop: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap',
                color: 'var(--muted)',
                fontSize: '0.84rem',
              }}
            >
              <span>Natural language works best: “Which hall needs attention right now?”</span>
              <span>{loading ? 'Analyzing current records...' : 'Connected to local attendance intelligence'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIAssistantPanel;
