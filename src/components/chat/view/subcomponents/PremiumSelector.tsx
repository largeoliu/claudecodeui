import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../../lib/utils';

export interface SelectOption {
  id: string;
  name: string;
  icon?: LucideIcon;
  color?: string;
}

interface PremiumSelectorProps {
  selectedValue: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  triggerIcon?: LucideIcon;
  triggerColor?: string;
  className?: string; // Container width, e.g., "w-32"
  placeholder?: string;
  onClose?: () => void;
  title?: string;
}

export default function PremiumSelector({
  selectedValue,
  options,
  onChange,
  triggerIcon: TriggerIcon,
  triggerColor = 'text-white/70',
  className = 'w-fit',
  placeholder,
  onClose,
  title,
}: PremiumSelectorProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  const selectedOption = options.find((opt) => opt.id === selectedValue) || options[0];
  const DisplayIcon = selectedOption?.icon || TriggerIcon;
  const displayColor = selectedOption?.color || triggerColor;

  return (
    <div className={cn("relative z-[1000]", className)} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border transition-all duration-300 shadow-inner px-2.5",
          isOpen 
            ? "bg-white/10 border-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)]" 
            : "bg-white/[0.05] border-white/[0.08] text-white/70 hover:bg-white/[0.08] hover:border-white/20 hover:text-white/90"
        )}
        title={title || placeholder}
      >
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          {DisplayIcon && (
            <DisplayIcon 
              className={cn(
                "h-3.5 w-3.5 flex-shrink-0 transition-opacity", 
                displayColor,
                selectedValue === 'none' && !isOpen ? 'opacity-40' : 'opacity-100',
                isOpen && "drop-shadow-[0_0_5px_currentColor]"
              )} 
            />
          )}
          <span className={cn(
            "text-[11px] font-bold uppercase tracking-tight truncate",
            selectedValue === 'none' && !isOpen ? 'text-white/30' : ''
          )}>
            {selectedOption?.name || placeholder}
          </span>
        </div>
        <ChevronDown className={cn(
          "h-3 w-3 flex-shrink-0 text-white/30 transition-transform duration-300", 
          isOpen ? "rotate-180 text-white/60" : "group-hover:text-white/50"
        )} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 right-0 z-[1001] mb-3 max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-[#0a0a0a] shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-3xl animate-stagger-in no-scrollbar">
          <div className="flex flex-col">
            {options.map((option, idx) => {
              const OptionIcon = option.icon;
              const isSelected = option.id === selectedValue;

              return (
                <button
                  key={option.id}
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                    onClose?.();
                  }}
                  className={cn(
                    "flex w-full items-center gap-1.5 px-3 py-2.5 text-left transition-all duration-300 hover:bg-white/[0.08]",
                    isSelected ? "bg-white/[0.06] text-white" : "text-white/40 group-hover:text-white/70",
                    idx === 0 && "rounded-t-lg",
                    idx === options.length - 1 && "rounded-b-lg"
                  )}
                >
                  <div className={cn("flex-shrink-0", option.color || 'text-white/30')}>
                    {OptionIcon ? (
                      <OptionIcon className={cn("h-3.5 w-3.5", isSelected && "drop-shadow-[0_0_8px_currentColor]")} />
                    ) : (
                      <div className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-tight truncate">
                    {option.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
