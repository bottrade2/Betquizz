import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { playTick, playUrgentTick } from '../utils/sounds';

const C = 2 * Math.PI * 22;
const TIME_LIMIT = 15;

export default function Quiz({ question, questionIndex, total, timeLeft, onAnswer, answerResult, yourScore, opponentScore, opponentName }) {
  const { t, lang } = useLanguage();
  const [selected, setSelected] = useState(null);
  const prevTimeLeft = useRef(timeLeft);

  // Tick sounds for countdown
  useEffect(() => {
    if (selected !== null) return;
    if (timeLeft <= 0) return;
    if (timeLeft !== prevTimeLeft.current) {
      if (timeLeft <= 3) playUrgentTick();
      else if (timeLeft <= 6) playTick();
      prevTimeLeft.current = timeLeft;
    }
  }, [timeLeft, selected]);

  const displayText    = lang === 'en' ? question.text    : (question[lang]?.q ?? question.text);
  const displayOptions = lang === 'en' ? question.options : (question[lang]?.o ?? question.options);

  useEffect(() => { setSelected(null); }, [questionIndex]);

  const answer = (i) => {
    if (selected !== null) return;
    setSelected(i);
    onAnswer(i);
  };

  // Determine button class after server responds with result
  const getBtnClass = (i) => {
    let cls = 'answer-btn';
    if (answerResult && selected !== null) {
      if (i === answerResult.answerIndex) {
        cls += answerResult.correct ? ' correct' : ' wrong';
      } else {
        cls += ' dim';
      }
    } else if (selected === i) {
      cls += ' selected';
    }
    return cls;
  };

  const progress = timeLeft / TIME_LIMIT;
  const offset   = C * (1 - progress);
  const urgent   = timeLeft <= 5;
  const keys     = ['A', 'B', 'C', 'D'];

  return (
    <div className="quiz-wrap">
      <div className="quiz-bar">
        <span className="quiz-count">{questionIndex + 1} / {total}</span>
        <div className="quiz-progress">
          <div className="quiz-progress-fill" style={{ width: `${(questionIndex / total) * 100}%` }} />
        </div>
      </div>

      <div className="quiz-scoreboard">
        <div className="quiz-player self">
          <span className="quiz-player-name">{t('quiz_you')}</span>
          <span className="quiz-player-score">{yourScore}</span>
        </div>
        <span className="quiz-vs">vs</span>
        <div className="quiz-player">
          <span className="quiz-player-name">{opponentName}</span>
          <span className="quiz-player-score">{opponentScore}</span>
        </div>
        <div className="timer-wrap">
          <svg width="56" height="56" viewBox="0 0 56 56">
            <circle className="timer-track" cx="28" cy="28" r="22" />
            <circle className={`timer-fill${urgent ? ' urgent' : ''}`} cx="28" cy="28" r="22"
              strokeDasharray={C} strokeDashoffset={offset} />
          </svg>
          <div className={`timer-val${urgent ? ' urgent' : ''}`}>{Math.max(0, timeLeft)}</div>
        </div>
      </div>

      <div className="question-card">
        <div className="question-topic">{t('quiz_question')} {questionIndex + 1}</div>
        <p className="question-text">{displayText}</p>
      </div>

      <div className="answers-grid">
        {displayOptions.map((opt, i) => (
          <button key={i}
            className={getBtnClass(i)}
            onClick={() => answer(i)}
            disabled={selected !== null}>
            <span className="answer-key">{keys[i]}</span>
            <span style={{ flex: 1 }}>{opt}</span>
            {answerResult && i === answerResult.answerIndex && (
              <span style={{ marginLeft: 8, fontWeight: 700 }}>
                {answerResult.correct ? '✓' : '✗'}
              </span>
            )}
          </button>
        ))}
      </div>

      {selected !== null && (
        <div className="answer-feedback" style={{ background: 'var(--fog-2)', border: '1px solid var(--fog-3)' }}>
          <div className="feedback-label" style={{
            color: answerResult ? (answerResult.correct ? 'var(--pos)' : 'var(--neg)') : 'var(--text-2)',
            fontWeight: 600
          }}>
            {answerResult
              ? answerResult.correct
                ? `✓ +${answerResult.points}pts`
                : `✗ ${t('quiz_wrong')}`
              : t('quiz_answer_sent')}
          </div>
        </div>
      )}
    </div>
  );
}
