---
title: "Installing a multinode Kubernetes cluster using kubeadm"
date: 2020-07-29T22:15:15+02:00
draft: false
slug: "installing-multinode-kubernetes-cluster-kubeadm"
tags: ["kubernetes", "docker", "linux", "virtualbox", "kubeadm"]

showpagemeta: true
toc: false
---

I have been playing around with Kubernetes in various settings for almost three years. Majority of it in production. Where the infrastructure was either setup and configured by experienced platform engineers, or it was hosted on Google as GKE clusters. My interaction with Kubernetes has been limited to mostly handling the deployments that I work on.

Recently I decided to start learning Kubernetes at a greater depth. So what better place to start than installing and configuring a multi node cluster on my laptop? To be honest, it took me a few attempts to get things working. For that reason I decided to create this blog post documenting the process as a tutorial. If you too are curious about setting up a Kubernetes playground on your laptop or PC, read along.

### Before we begin

For this tutorial we are going to install the Kubernetes nodes on VirtualBox virtual machines running Debian Buster. The steps would be slightly different for any other combination of hypervisior and guest operating system. 

It is recommended that your system has sufficient memory and CPUs available that can be allocated to the virtual machines. The test cluster should work fine on a computer with a modest Intel Core i5 or AMD Ryzen processor as long as the host has enough free memory to share with the VMs.


### Creating the VMs and setting up the network

At the end of this tutorial we would like to have a Kubernetes cluster with a single control plane and two workers. That translates to three virtual machines. As for network interfaces: we would want to create a couple of them. First, a NAT adapter for the virtual machines to access the Internet. Second, a Host-Only interface for letting the the VMs communicate amongst each other and the host operating system. The following diagram gives an overview of how we plan to implement our network.

<p align="center">
    <img src="/img/k8s-nw-layout.png">
</p>

Before you begin make sure that the VBoxManage is accessible from your shell. In case it isn't, update the PATH variable to include the path to your VirtualBox installation. 

Let's start with creating the virtual machines.


```powershell
PS> VBoxManage createvm --name k8smaster --ostype Linux_64 --register
PS> VBoxManage createvm --name k8snode1 --ostype Linux_64 --register
PS> VBoxManage createvm --name k8snode2 --ostype Linux_64 --register
```

Each worker node will be allocated 1 cpu, 2 GB memory, and 12 MB video memory. The master will get 2 cpus and the other allocations remain unchanged.

```powershell
PS> VBoxManage modifyvm k8smaster --cpus 2 --memory 2048 --vram 12
PS> VBoxManage modifyvm k8snode1 --cpus 1 --memory 2048 --vram 12
PS> VBoxManage modifyvm k8snode2 --cpus 1 --memory 2048 --vram 12
```

Next we need to create virtual disks that will be used for secondary storage by our virtual machines. We wil create three dynamic storage disks 10 GB each.

```powershell
PS> VBoxManage createhd --filename 'D:\Virtual Machines\k8smaster.vdi' --size 10240 --variant Standard
PS> VBoxManage createhd --filename 'D:\Virtual Machines\k8snode1.vdi' --size 10240 --variant Standard
PS> VBoxManage createhd --filename 'D:\Virtual Machines\k8snode2.vdi' --size 10240 --variant Standard
```

Before proceeding make sure to download the Debain installation image from [here](https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-10.4.0-amd64-netinst.iso).

Once you have downloaded the image on system, we can go ahead and configure the virtual machines to use the Debian disk image and the newly created virtual hard disk.

```powershell
# configure the master vm
PS> VBoxManage storagectl k8smaster  --name "SATA Controller" --add sata --bootable on
PS> VBoxManage storagectl k8smaster  --name "IDE Controller" --add ide
PS> VBoxManage storageattach k8smaster --storagectl "SATA Controller" --port 0 --device 0 --type hdd --medium "D:\Virtual Machines\k8smaster.vdi"
PS> VBoxManage storageattach k8smaster --storagectl "IDE Controller" --port 0 --device 0 --type dvddrive --medium "D:\Downloads\debian-10.4.0-amd64-netinst.iso"

# configure node1 vm
PS> VBoxManage storagectl k8snode1  --name "SATA Controller" --add sata --bootable on
PS> VBoxManage storagectl k8snode1  --name "IDE Controller" --add ide
PS> VBoxManage storageattach k8snode1 --storagectl "SATA Controller" --port 0 --device 0 --type hdd --medium "D:\Virtual Machines\k8snode1.vdi"
PS> VBoxManage storageattach k8snode1 --storagectl "IDE Controller" --port 0 --device 0 --type dvddrive --medium "D:\Downloads\debian-10.4.0-amd64-netinst.iso"

# configure node2 vm
PS> VBoxManage storagectl k8snode2  --name "SATA Controller" --add sata --bootable on
PS> VBoxManage storagectl k8snode2  --name "IDE Controller" --add ide
PS> VBoxManage storageattach k8snode2 --storagectl "SATA Controller" --port 0 --device 0 --type hdd --medium "D:\Virtual Machines\k8snode2.vdi"
PS> VBoxManage storageattach k8snode2 --storagectl "IDE Controller" --port 0 --device 0 --type dvddrive --medium "D:\Downloads\debian-10.4.0-amd64-netinst.iso"
```

That leaves us only with the network configuration. When you create a new virtual machine on VirtualBox, by default nic1 is configured to use a NAT adapter. You can verify this by running `VBoxManage showvminfo <vmname> | grep "NIC 1"`.

The last step in our setup is to configure the host only interface for internal communication. Before we do so, we need to decide the ip ranges for the network. We can use the IP range `10.10.0.1/16` on this network interface. The master and the two worker vms can be assigned IPs `10.10.0.2`, `10.10.0.3`, and `10.10.0.4` respectively. We also need to define a subnet for our pods. For which we can use `10.10.128.1/17`. This subnet will be required later when we configure the CNI.

```powershell
PS> VBoxManage hostonlyif create
...
Interface 'VirtualBox Host-Only Ethernet Adapter #5' was successfully created
...

PS> VBoxManage hostonlyif ipconfig "VirtualBox Host-Only Ethernet Adapter #5" --ip 10.10.0.1 --netmask 255.255.0.0

# configure the vms to use the nic
PS> VBoxManage modifyvm k8smaster --nic2 hostonly --hostonlyadapter1 "VirtualBox Host-Only Ethernet Adapter #5"
PS> VBoxManage modifyvm k8snode1 --nic2 hostonly --hostonlyadapter1 "VirtualBox Host-Only Ethernet Adapter #5"
PS> VBoxManage modifyvm k8snode2 --nic2 hostonly --hostonlyadapter1 "VirtualBox Host-Only Ethernet Adapter #5"
```
### Installing and configuring the operating system

We are now ready to install the operating system on our virtual machines. Fire up the vms with the following commands.

```powershell
PS> VBoxManage startvm k8smaster
PS> VBoxManage startvm k8snode1
PS> VBoxManage startvm k8snode2
```
Select the second option from the list, **Install**.

Choose your preferred language and location settings.

In the next screen you'll be asked to select your preferred network interface. Select **enp0s3**. This will give the installer access to the internet for pulling the missing packages.

For the host names, let's assign them `k8smaster`, `k8snode1`, and `k8snode2` respectively. We can put all the VMs in a domain named `kubernetest`.

After setting the root password. The installer will ask you to create a new user. We will be using this new user to SSH into the nodes.

Next you'll be asked to configure your storage medium, and specify a mount point the file system. Either you can select the guided option or you can manually create a partition for the file system. In case you do it manually, do not create a swap partition. This would anyway need to be turned off before we can bootstrap Kubernetes. However, if you select the guided mode don't worry we can turn off swap usage later.

In the software selection page, select only **SSH server** and **Standard system utilities**. We do not need a desktop environment for any of the virtual machines.

Once the installation completes you'll be asked to confirm the master boot record. Select **/dev/sda** from the list and complete installation.

### Configuring the operating system

Congratulations! You have successfully installed Debian on all three virtual machines. Login to the machines with root credentials to install a few utilities that will be required to complete the setup.

```bash
root@<vm-hostname>:~$ apt-get update && apt-get install -y sudo curl gnupg net-tools

# add your user to the list of sudoers
root@<vm-hostname>:~$ usermod -aG sudo <username>
```

We are left with making the machines acquire IPs on the host only interface. For this we will have to make the following entries to `/etc/network/interfaces`.

```
auto enp0s8
iface enp0s8 inet static
address 10.10.0.X # where X=2 for k8smaster, 3 for k8snode1, and 4 for k8snode2
network 10.10.0.1
netmask 255.255.0.0
```

You can now restart your networking services and verify the changes using `ifconfig`.

```bash
root@<vm-hostname>:~$ systemctl restart networking
root@<vm-hostname>:~$ ifconfig
...
enp0s8: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
        inet 10.10.0.X  netmask 255.255.0.0  broadcast 10.10.255.255
        inet6 ...  prefixlen 64  scopeid 0x20<link>
        ether ...  txqueuelen 1000  (Ethernet)
        RX packets 119  bytes 11191 (10.9 KiB)
        RX errors 0  dropped 0  overruns 0  frame 0
        TX packets 98  bytes 11925 (11.6 KiB)
        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0
...
```

That completes the setup of the environment. We can now focus on installing Docker and Kubernetes. You can now reboot all three virtual machines and login into them using SSH from your host terminal.

### Installing Docker and Kubernetes

We will be installing both pieces of software from their official repositories.

```bash
# download and add gpg keys
<user>@<vm-hostname>~$ curl -fsSL https://download.docker.com/linux/debian/gpg | sudo apt-key add -
<user>@<vm-hostname>~$ curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key add -

# add repository details to the list of apt sources
<user>@<vm-hostname>~$ cat <<EOF | sudo tee /etc/apt/sources.list.d/docker.list
deb [arch=amd64] https://download.docker.com/linux/debian buster stable
EOF
<user>@<vm-hostname>~$ cat <<EOF | sudo tee /etc/apt/sources.list.d/k8s.list
deb [arch=amd64] https://apt.kubernetes.io/ kubernetes-xenial main
EOF

# install docker and kubernetes
<user>@<vm-hostname>~$ sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io kubeadm kubectl kubelet
```

### Bootstrapping the cluster

Now our virtual machines are ready to be bootstrapped with kubeadm. First, we need to set up the control plane on the k8smaster virtual machine. Then we will make the other two vms join the cluster as workers.

In case you have not disabled swap already, you can do it now with the following command.

```bash
<user>@<vm-hostname>~$ sudo swapoff -a
```

We will execute `kubeadm init` to create the control plane on the k8smaster after which we shall install `calico` as our CNI.

```bash
<user>@k8smaster~$ sudo kubeadm init --apiserver-advertise-address=10.10.0.2 --pod-network-cidr=10.10.128.1/17
...

To start using your cluster, you need to run the following as a regular user:

  mkdir -p $HOME/.kube
  sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
  sudo chown $(id -u):$(id -g) $HOME/.kube/config

Then you can join any number of worker nodes by running the following on each as root:

kubeadm join 10.10.0.2:6443 --token 8rgorl.4h52rlf8rau2jxq7 \
    --discovery-token-ca-cert-hash sha256:39fa02d151ad3d1ded96956060663ca893ece4cc0e1212b58ae1c417afd30c1d
```

Copy the `admin.conf` file to your home directory as shown in the output above. Make a note of the token and the certificate hash displayed by the above command. We will need those to make the other virtual machines join the cluster. But before we do that, let's install our CNI.

We will download the manifest file from the official website of calico and then make changes to it in order to include our new network settings.

```bash
<user>@k8smaster~$ wget https://docs.projectcalico.org/v3.14/manifests/calico.yaml
```

Modify the value of `CALICO_IPV4POOL_CIDR` to `10.10.128.1/17`. Once done save the file and apply the manifest.

```bash
<user>@k8smaster~$ kubectl apply -f calico.yaml

# verify that the calico nodes are up and running
<user>@k8smaster~$ kubectl get pods -n kube-system
NAME                                       READY   STATUS    RESTARTS   AGE
calico-kube-controllers-76d4774d89-fn5pr   1/1     Running   0          3m2s
calico-node-z8bs5                          1/1     Running   0          3m2s
coredns-66bff467f8-ckq26                   1/1     Running   0          25m
coredns-66bff467f8-k8r2b                   1/1     Running   0          25m
etcd-k8smaster                             1/1     Running   0          26m
kube-apiserver-k8smaster                   1/1     Running   0          26m
kube-controller-manager-k8smaster          1/1     Running   0          26m
kube-proxy-8bvfz                           1/1     Running   0          25m
kube-scheduler-k8smaster                   1/1     Running   0          26m
```
You can now switch to the other two virtual machines and run the following command to join the cluster. (Turn off swap in the other VMs if you have not done it already)

```bash
# join the cluster from node 1
<user>@k8snode1~$ sudo kubeadm join 10.10.0.2:6443 --token <token>  --discovery-token-ca-cert-hash sha256:<hash>

# join the cluster from node 2
<user>@k8snode2~$ sudo kubeadm join 10.10.0.2:6443 --token <token>  --discovery-token-ca-cert-hash sha256:<hash>
```

### Making our first deployment

Now we are ready to make our first deployment on our cluster.

```bash
<user>@k8smaster~$ kubectl apply -f https://raw.githubusercontent.com/kubernetes/website/master/content/en/examples/controllers/nginx-deployment.yaml

<user>@k8smaster~$ kubectl get pods -o wide
NAME                                READY   STATUS    RESTARTS   AGE   IP              NODE       NOMINATED NODE   READINESS GATES
nginx-deployment-6b474476c4-7z47l   1/1     Running   0          60s   10.10.181.2     k8snode2   <none>           <none>
nginx-deployment-6b474476c4-ddgwc   1/1     Running   0          60s   10.10.130.129   k8snode1   <none>           <none>
nginx-deployment-6b474476c4-r7hn2   1/1     Running   0          60s   10.10.181.1     k8snode2   <none>           <none>
```

And that's it. You have successfully deployed your first application on a Kubernetes cluster that you created from scratch.

That concludes the tutorial. I plan to write more blog posts on Kubernetes and other workload orchestration tools as I progress on this journey.