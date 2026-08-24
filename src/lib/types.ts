export type MarkValue = 0 | 1 | 2;

export type Habit = {
  id: string;
  name: string;
  position: number;
  createdAt?: string;
  archivedAt?: string;
};

export type Thought = {
  id: string;
  text: string;
  position: number;
  createdAt?: string;
};

export type Entry = {
  habitId: string;
  date: string;
  value: MarkValue;
};

export type Board = {
  createdAt: string;
  updatedAt?: string;
  habits: Habit[];
  archivedHabits?: Habit[];
  thoughts?: Thought[];
  entries: Entry[];
  entriesDelta?: boolean;
};

export type Credentials = {
  boardId: string;
  secret: string;
  recoveryCode?: string;
  pendingCreate?: boolean;
};
