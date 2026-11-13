package ng.nifelux.colonai

import android.app.Activity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.ImageButton
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** A simple list dialog (tabs, bookmarks, history): tap to open, × to remove, optional action button. */
object EntryList {
    data class Item(val key: String, val title: String, val subtitle: String, val highlighted: Boolean = false)

    fun show(
        activity: Activity,
        title: String,
        items: List<Item>,
        emptyText: String,
        onPick: (Item) -> Unit,
        onRemove: ((Item) -> Unit)?,
        action: Pair<String, () -> Unit>? = null,
    ): AlertDialog {
        val rows = items.toMutableList()
        lateinit var dialog: AlertDialog
        val list = ListView(activity).apply { divider = null; isVerticalScrollBarEnabled = true }
        val empty = TextView(activity).apply {
            text = emptyText
            setPadding(48, 32, 48, 32)
            setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyMedium)
        }
        val adapter = object : BaseAdapter() {
            override fun getCount() = rows.size
            override fun getItem(position: Int) = rows[position]
            override fun getItemId(position: Int) = position.toLong()
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = convertView ?: LayoutInflater.from(activity).inflate(R.layout.item_entry, parent, false)
                val item = rows[position]
                v.findViewById<TextView>(R.id.entry_title).text = item.title
                v.findViewById<TextView>(R.id.entry_subtitle).apply {
                    text = item.subtitle
                    visibility = if (item.subtitle.isBlank()) View.GONE else View.VISIBLE
                }
                v.isActivated = item.highlighted
                v.setOnClickListener { dialog.dismiss(); onPick(item) }
                v.findViewById<ImageButton>(R.id.entry_remove).apply {
                    visibility = if (onRemove == null) View.GONE else View.VISIBLE
                    contentDescription = activity.getString(R.string.remove_item, item.title)
                    setOnClickListener {
                        rows.remove(item)
                        onRemove?.invoke(item)
                        notifyDataSetChanged()
                        empty.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
                    }
                }
                return v
            }
        }
        list.adapter = adapter
        val box = android.widget.FrameLayout(activity).apply {
            addView(list)
            addView(empty)
        }
        empty.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
        val b = MaterialAlertDialogBuilder(activity).setTitle(title).setView(box)
            .setNegativeButton(R.string.close, null)
        action?.let { (label, run) -> b.setPositiveButton(label) { _, _ -> run() } }
        dialog = b.create()
        dialog.show()
        return dialog
    }
}
