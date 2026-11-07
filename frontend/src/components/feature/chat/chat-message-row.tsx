import type { ChatMessage, MessageEmoji } from '@/lib/chat-types';
import type { AccountAuth } from '../auth/use-account-auth';
import { MessageEmojiEffect } from './emoji/message-emoji-effect';
import styles from './chat-workspace.module.css';

type ChatMessageRowProps = {
  message: ChatMessage;
  selfId: string;
  isGroup: boolean;
  request: AccountAuth['request'];
  attachments: MessageEmoji[];
  seenEmojiIds: Set<string>;
  fireworkTarget: HTMLElement | null;
  onAttachment: (attachment: MessageEmoji) => void;
};

function displayTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function ChatMessageRow({
  message, selfId, isGroup, request, attachments, seenEmojiIds, fireworkTarget, onAttachment,
}: ChatMessageRowProps) {
  const own = message.senderId === selfId;
  const showSender = !own && isGroup;
  const rowClassName = [
    styles.messageRow,
    own ? `${styles.ownMessageRow} ${styles.ownMessage}` : '',
    showSender ? styles.groupMessageRow : '',
  ].join(' ');

  return (
    <li className={rowClassName}>
      {showSender && <strong className={styles.messageSender}>{message.senderName}</strong>}
      <div className={styles.messageBubble}>
        <p>{message.text}</p>
        <time>{displayTime(message.sentAt)}</time>
      </div>
      <MessageEmojiEffect
        roomId={message.roomId}
        messageId={message.messageId}
        request={request}
        attachments={attachments}
        seenEmojiIds={seenEmojiIds}
        fireworkTarget={fireworkTarget}
        onAttachment={onAttachment}
      />
    </li>
  );
}
