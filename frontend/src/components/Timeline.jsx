import React from 'react';
import { motion } from 'framer-motion';
import { FileText, Eye, Send, CheckCircle2 } from 'lucide-react';

const getStatusConfig = (label) => {
  switch (label) {
    case 'Submitted':
      return { icon: FileText, color: 'status-submitted-badge-new', dotBg: '#2563eb' };
    case 'In Review':
      return { icon: Eye, color: 'status-in-review-badge-new', dotBg: '#E85D26' };
    case 'Forwarded':
      return { icon: Send, color: 'status-forwarded-badge-new', dotBg: '#ea580c' };
    case 'Resolved':
      return { icon: CheckCircle2, color: 'status-resolved-badge-new', dotBg: '#16a34a' };
    default:
      return { icon: FileText, color: 'status-submitted-badge-new', dotBg: '#2563eb' };
  }
};

export default function Timeline({ updates }) {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.12,
      },
    },
  };

  const itemAnim = {
    hidden: { opacity: 0, y: 15 },
    show: { 
      opacity: 1, 
      y: 0, 
      transition: { 
        type: 'spring', 
        stiffness: 100, 
        damping: 15 
      } 
    },
  };

  return (
    <motion.div
      className="timeline-container-modern-new"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <div className="timeline-line-modern-new">
        <motion.div
          className="timeline-line-progress-new"
          initial={{ height: 0 }}
          animate={{ height: '100%' }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>

      {updates.map((update, index) => {
        const config = getStatusConfig(update.label);
        const Icon = config.icon;
        // Only the latest (current) status dot pulses — a single "live" cue.
        // Previously every dot ran an infinite animation, draining CPU/battery
        // on low-end citizen devices (N perpetual loops per open complaint).
        const isCurrent = index === updates.length - 1;

        return (
          <motion.div
            key={`${update.at}-${index}`}
            className="timeline-item-modern-new"
            variants={itemAnim}
          >
            <div className="timeline-dot-container-new">
              <motion.div
                className="timeline-dot-outer-glow-new"
                animate={isCurrent ? { scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] } : { scale: 1, opacity: 0.6 }}
                transition={isCurrent ? {
                  duration: 2.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                } : { duration: 0 }}
                style={{
                  boxShadow: `0 0 12px ${config.dotBg}60`,
                  borderColor: `${config.dotBg}30`,
                }}
              >
                <div
                  className="timeline-dot-inner-core-new"
                  style={{ backgroundColor: config.dotBg }}
                />
              </motion.div>
            </div>

            <div className="timeline-card-modern-new">
              <div className="timeline-card-header-new">
                <span className={`status-badge-pill-new ${config.color}`}>
                  <Icon size={12} style={{ marginRight: '5px' }} />
                  {update.label}
                </span>
                <span className="timeline-card-time-new">{update.at}</span>
              </div>
              <p className="timeline-card-note-new">{update.note}</p>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
