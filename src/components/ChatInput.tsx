import { useRef, useEffect, useCallback, type ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  maxRows?: number;
  autoFocus?: boolean;
  footer?: ReactNode;
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  placeholder = '',
  disabled = false,
  maxRows = 6,
  autoFocus = false,
  footer,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 22;
    const maxHeight = lineHeight * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxRows]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => textareaRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  };

  return (
    <div className="w-full rounded-xl border border-gray-200 bg-gray-50 focus-within:border-gray-300 focus-within:bg-white transition-all">
      <div className="flex items-end gap-2 px-3 pt-2.5 pb-1.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm leading-[22px] text-gray-800 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={onSend}
          disabled={!value.trim() || disabled}
          className="shrink-0 p-1.5 rounded-lg bg-gray-800 text-white disabled:bg-gray-200 disabled:text-gray-400 transition-colors hover:bg-black mb-px"
        >
          <ArrowUp size={14} strokeWidth={2.5} />
        </button>
      </div>
      {footer && (
        <div className="px-3 pb-2">
          {footer}
        </div>
      )}
    </div>
  );
}
