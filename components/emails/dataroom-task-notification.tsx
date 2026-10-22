type DataroomTaskNotificationProps = {
  dataroomName: string;
  taskTitle: string;
  activityLines: string[];
  dataroomUrl?: string | null;
};

export default function DataroomTaskNotification({
  dataroomName,
  taskTitle,
  activityLines,
  dataroomUrl,
}: DataroomTaskNotificationProps) {
  return (
    <div
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: "#111827",
        lineHeight: "1.5",
      }}
    >
      <h2 style={{ margin: "0 0 16px" }}>Request list activity</h2>

      <p style={{ margin: "0 0 8px" }}>
        <strong>Data room:</strong> {dataroomName}
      </p>

      <p style={{ margin: "0 0 20px" }}>
        <strong>Request:</strong> {taskTitle}
      </p>

      <ul style={{ margin: "0 0 24px", paddingLeft: "20px" }}>
        {activityLines.map((line, index) => (
          <li key={`${index}-${line}`} style={{ marginBottom: "8px" }}>
            {line}
          </li>
        ))}
      </ul>

      {dataroomUrl ? (
        <p style={{ margin: 0 }}>
          <a href={dataroomUrl}>Open data room</a>
        </p>
      ) : null}
    </div>
  );
}
