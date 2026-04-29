import React, { useState, useRef, useEffect } from 'react';
import api from '../api/client';

export default function AIChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Merhaba! Ben InvenTrOps asistanı. Size envanteriniz hakkında yardımcı olabilir veya güncellemeler yapabilirim. Nasıl yardımcı olabilirim?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // API'ye tüm geçmişi gönderiyoruz
      const response = await api.post('/ai/chat', { 
        messages: [...messages, userMessage] 
      });

      setMessages(prev => [...prev, response]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-chat-container">
      {/* Floating Toggle Button */}
      <button 
        className={`ai-toggle-btn ${isOpen ? 'active' : ''}`} 
        onClick={() => setIsOpen(!isOpen)}
        title="AI Assistant"
      >
        {isOpen ? (
          <span style={{ fontSize: '1.5rem' }}>×</span>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            <circle cx="9" cy="10" r="1"></circle>
            <circle cx="15" cy="10" r="1"></circle>
          </svg>
        )}
        {!isOpen && <div className="pulse-dot" />}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="ai-chat-window glassmorphism">
          <div className="ai-chat-header">
            <div className="ai-status-dot" />
            <h3>InvenTrOps AI Assistant</h3>
          </div>
          
          <div className="ai-chat-body">
            {messages.map((msg, i) => (
              <div key={i} className={`ai-message ${msg.role}`}>
                <div className="ai-message-bubble">
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="ai-message assistant">
                <div className="ai-message-bubble typing-dots">
                  <span>.</span><span>.</span><span>.</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSend} className="ai-chat-footer">
            <input 
              type="text" 
              placeholder="Sorunuzu buraya yazın..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button type="submit" disabled={loading || !input.trim()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </div>
      )}

      <style>{`
        .ai-chat-container {
          position: fixed;
          bottom: 30px;
          right: 30px;
          z-index: 1000;
          font-family: 'Inter', sans-serif;
        }

        .ai-toggle-btn {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: linear-gradient(135deg, #0d9488 0%, #0f172a 100%);
          color: white;
          border: none;
          cursor: pointer;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          position: relative;
        }

        .ai-toggle-btn:hover {
          transform: scale(1.1);
        }

        .pulse-dot {
          position: absolute;
          top: 0;
          right: 0;
          width: 14px;
          height: 14px;
          background: #22c55e;
          border-radius: 50%;
          border: 2px solid #0f172a;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }

        .ai-chat-window {
          position: absolute;
          bottom: 80px;
          right: 0;
          width: 380px;
          height: 500px;
          border-radius: 20px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: slideIn 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .glassmorphism {
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow: 0 15px 35px rgba(0,0,0,0.5);
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .ai-chat-header {
          padding: 18px 20px;
          background: rgba(255, 255, 255, 0.05);
          display: flex;
          align-items: center;
          gap: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .ai-status-dot {
          width: 8px;
          height: 8px;
          background: #22c55e;
          border-radius: 50%;
        }

        .ai-chat-header h3 {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 600;
          color: white;
        }

        .ai-chat-body {
          flex: 1;
          padding: 20px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .ai-message {
          display: flex;
          max-width: 85%;
        }

        .ai-message.user {
          align-self: flex-end;
        }

        .ai-message-bubble {
          padding: 12px 16px;
          border-radius: 18px;
          font-size: 0.88rem;
          line-height: 1.4;
          white-space: pre-wrap;
        }

        .user .ai-message-bubble {
          background: #0d9488;
          color: white;
          border-bottom-right-radius: 4px;
        }

        .assistant .ai-message-bubble {
          background: rgba(255, 255, 255, 0.1);
          color: #e2e8f0;
          border-bottom-left-radius: 4px;
        }

        .typing-dots span {
          animation: blink 1.4s infinite both;
          font-size: 1.2rem;
          margin: 0 1px;
        }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes blink {
          0% { opacity: .2; }
          20% { opacity: 1; }
          100% { opacity: .2; }
        }

        .ai-chat-footer {
          padding: 15px 20px;
          background: rgba(0, 0, 0, 0.2);
          display: flex;
          gap: 10px;
        }

        .ai-chat-footer input {
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 10px 15px;
          color: white;
          font-size: 0.85rem;
          outline: none;
        }

        .ai-chat-footer button {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: #0d9488;
          color: white;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s;
        }

        .ai-chat-footer button:hover:not(:disabled) {
          background: #0f766e;
        }

        .ai-chat-footer button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
