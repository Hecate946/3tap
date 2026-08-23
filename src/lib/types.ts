export type MarkValue = 0 | 1 | 2;

export type Habit = {
  id: string;
  name: string;
  position: number;
  createdAt?: string;
  archivedAt?: string;
};

export type Entry = {
  habitId: string;
  date: string;
  value: 1 | 2;
};

export type Board = {
  createdAt: string;
  updatedAt?: string;
  habits: Habit[];
  archivedHabits?: Habit[];
  entries: Entry[];
};

export type Credentials = {
  boardId: string;
  secret: string;
  recoveryCode?: string;
};
