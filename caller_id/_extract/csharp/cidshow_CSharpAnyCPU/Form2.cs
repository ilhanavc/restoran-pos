using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Text;
using System.Windows.Forms;

namespace WindowsFormsApplication1
{
    public partial class Form2 : Form
    {
        public string info;
        public string callerID;

        public Form2()
        {
            InitializeComponent();
        }

        private void button1_Click(object sender, EventArgs e)
        {
            this.Close();
 
        }

        private void Form2_Load(object sender, EventArgs e)
        {
            
            textBox1.Text = info;
            textBox2.Text += "\nPhone : " + callerID;
            Text = callerID + "  calling..."; 

        }

        private void button2_Click(object sender, EventArgs e)
        {
            this.Close();
        }
    }
}
